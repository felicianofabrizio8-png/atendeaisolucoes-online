"""Workflow de um turno de vendas.

```text
carregar contexto -> working memory -> episódica -> RAG -> agente
   -> decisão estruturada -> Policy Engine -> executar/persistir -> salvar estado
```

**Sobre Pydantic Graph.** O briefing pediu Pydantic AI + Pydantic Graph. O
Pydantic AI está no agente; o Graph **não** está aqui, e é uma escolha que
vale justificar: este fluxo é uma sequência reta, sem ramificação nem retomada
durável. Um grafo para uma lista de passos adiciona vocabulário e indireção sem
resolver problema nenhum — e o próprio briefing pede para não criar abstração
sem necessidade.

O momento de trazer o Graph é quando aparecer a primeira ramificação real
(ex.: caminho de negociação que volta ao início depois de aprovação humana, ou
retomada de turno interrompido). Aí ele paga o custo. Se preferir o Graph já
agora, a conversão é direta: cada `_step_*` vira um nó.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from uuid import uuid4

from app.agents.sales_agent import build_agent
from app.database.connection import tenant_transaction
from app.database.repositories.chunks import ChunkRepository
from app.database.repositories.conversations import ConversationRepository
from app.database.repositories.knowledge import KnowledgeRepository
from app.database.repositories.leads import LeadRepository
from app.database.repositories.memory import MemoryRepository
from app.database.repositories.products import ProductRepository
from app.llm.gateway import LLMUnavailableError
from app.llm.routing import classify_turn
from app.memory import episodic, working
from app.observability.tracing import trace_turn
from app.policies import actions
from app.policies.execution import CompanyFlags, ExecutionContext, resolve_execution_mode
from app.policies.tenant import TenantScope
from app.retrieval.embeddings import get_embedding_provider
from app.retrieval.reranker import get_reranker
from app.schemas.agent import AgentDecision, SalesTurnRequest, SalesTurnResult
from app.tools.deps import AgentDeps


async def run_turn(request: SalesTurnRequest) -> SalesTurnResult:
    """Executa um turno completo. Não levanta exceção de LLM para o chamador:
    falha de modelo vira handoff, que é o comportamento seguro."""
    started = time.perf_counter()
    scope = TenantScope(
        company_id=request.company_id,
        correlation_id=request.correlation_id or str(uuid4()),
    )

    # Os dois `with` ficam aninhados, não combinados: o trace precisa abrir
    # ANTES da transação para registrar também uma falha de conexão ao banco.
    async with trace_turn(  # noqa: SIM117
        company_id=str(request.company_id),
        conversation_id=str(request.conversation_id),
        correlation_id=scope.correlation_id,
    ) as trace:
        async with tenant_transaction(scope) as conn:
            conversations = ConversationRepository(conn, scope)
            products = ProductRepository(conn, scope)
            leads_repo = LeadRepository(conn, scope)
            knowledge_repo = KnowledgeRepository(conn, scope)
            memory_repo = MemoryRepository(conn, scope)
            chunks_repo = ChunkRepository(conn, scope)

            # 1. Contexto da conversa -------------------------------------
            conversation = await conversations.get(request.conversation_id)
            if conversation is None:
                return _skip(
                    "conversation_not_found", started, trace_id=scope.correlation_id
                )

            lead_id = request.lead_id or conversation.get("lead_id")
            trace.span("context_loading", has_lead=lead_id is not None)

            # 2. Working memory -------------------------------------------
            memory = await working.load(
                conversations,
                scope_type=request.scope_type,
                scope_id=request.conversation_id,
                conversation_id=request.conversation_id,
            )
            trace.span(
                "memory_working",
                candidates=len(memory.candidate_product_ids),
                intent=memory.intent,
            )

            # 3. Memória episódica ----------------------------------------
            episodes = (
                await episodic.recall(memory_repo, lead_id) if lead_id else []
            )
            trace.span("memory_episodic", count=len(episodes))

            # 4. Histórico -------------------------------------------------
            history = request.history or await conversations.recent_messages(
                request.conversation_id, limit=12
            )
            last_lead_message = next(
                (m.text for m in reversed(history) if m.role == "lead"), ""
            )
            if not last_lead_message.strip():
                return _skip("no_lead_message", started, trace_id=scope.correlation_id)

            # 5. Modo de execução ------------------------------------------
            flags = CompanyFlags()  # TODO(fase 9): ler de ai_company_flags
            mode = resolve_execution_mode(
                flags, legacy_auto_reply_enabled=bool(conversation.get("ai_handling"))
            )
            execution = ExecutionContext(
                scope=scope,
                conversation_id=request.conversation_id,
                mode=mode,
                flags=flags,
                human_active=await conversations.is_human_active(request.conversation_id),
                auto_reply_count=int(conversation.get("auto_reply_count") or 0),
                seconds_since_last_auto_reply=await conversations.seconds_since_last_auto_reply(
                    request.conversation_id, datetime.now(UTC)
                ),
            )
            trace.span("policy_mode", mode=mode, human_active=execution.human_active)

            # 6. Agente ----------------------------------------------------
            deps = AgentDeps(
                scope=scope,
                execution=execution,
                conversation_id=request.conversation_id,
                lead_id=lead_id,
                products=products,
                leads=leads_repo,
                conversations=conversations,
                knowledge=knowledge_repo,
                memory=memory_repo,
                chunks=chunks_repo,
                embeddings=get_embedding_provider(),
                reranker=get_reranker(),
                idempotency_base=request.idempotency_key
                or f"{request.conversation_id}:{len(history)}",
            )

            model_class = classify_turn(
                last_lead_message, has_objections=bool(memory.objections)
            )
            agent = build_agent(
                company_name=await knowledge_repo.get_company_name() or "empresa",
                model_class=model_class,
            )

            prompt = _build_prompt(last_lead_message, memory, episodes)
            try:
                run = await agent.run(prompt, deps=deps)  # type: ignore[attr-defined]
                decision: AgentDecision = getattr(run, "output", None) or run.data  # type: ignore[attr-defined]
            except LLMUnavailableError as err:
                trace.span("llm_error", error=str(type(err).__name__))
                decision = AgentDecision(
                    action="handoff", reason="llm_unavailable", confidence=0.0
                )
            except Exception as err:
                trace.span("agent_error", error=type(err).__name__)
                decision = AgentDecision(
                    action="handoff", reason=f"agent_error:{type(err).__name__}"
                )

            decision = decision.model_copy(
                update={"tool_calls_used": deps.tool_names()}
            )
            trace.span(
                "decision",
                action=decision.action,
                tools=len(decision.tool_calls_used),
                confidence=decision.confidence,
            )

            # 7. Policy Engine ---------------------------------------------
            verdict = actions.evaluate(decision, execution)
            trace.span("policy", verdict=verdict.verdict, reason=verdict.reason)

            # 8. Estado -----------------------------------------------------
            if execution.capabilities.can_write_internal:
                memory.current_product_id = decision.current_product_id
                memory.candidate_product_ids = decision.suggested_product_ids
                memory.intent = decision.intent or memory.intent
                await working.save(conversations, memory)

            return SalesTurnResult(
                decision=decision,
                execution_mode=mode,
                executed=verdict.allowed,
                blocked_reason=verdict.reason if not verdict.allowed else None,
                trace_id=scope.correlation_id,
                latency_ms=int((time.perf_counter() - started) * 1000),
            )


def _build_prompt(last_message: str, memory: object, episodes: list) -> str:
    """Monta o contexto compacto.

    O histórico inteiro **não** entra. O que entra é o estado (que resolve
    "esse", "o segundo") mais o que já se sabe do cliente. É a diferença entre
    reenviar 20 mensagens por turno e enviar cinco linhas de estado.
    """
    from app.schemas.memory import WorkingMemory

    parts: list[str] = []
    if isinstance(memory, WorkingMemory):
        state: list[str] = []
        if memory.intent:
            state.append(f"intenção: {memory.intent}")
        if memory.current_product_id:
            state.append(f"produto em foco: {memory.current_product_id}")
        if memory.candidate_product_ids:
            state.append(
                "candidatos: " + ", ".join(str(p) for p in memory.candidate_product_ids)
            )
        if memory.city:
            state.append(f"cidade: {memory.city}")
        if memory.budget:
            state.append(f"orçamento mencionado: {memory.budget}")
        if memory.objections:
            state.append("objeções: " + "; ".join(memory.objections))
        if state:
            parts.append("Estado da conversa:\n" + "\n".join(f"- {s}" for s in state))

    if episodes:
        parts.append(episodic.to_context(episodes))

    parts.append(f"Última mensagem do cliente:\n{last_message}")
    return "\n\n".join(parts)


def _skip(reason: str, started: float, *, trace_id: str | None) -> SalesTurnResult:
    return SalesTurnResult(
        decision=AgentDecision(action="skip", reason=reason),
        execution_mode="silent",
        executed=False,
        blocked_reason=reason,
        trace_id=trace_id,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )


__all__ = ["run_turn"]
