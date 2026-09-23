"""Escopo de tenant.

Este é o guarda-corpo mais importante do serviço, e a razão dele existir está
na auditoria §5: **RLS não protege este caminho**. O plano server-side usa uma
conexão privilegiada, então o banco não vai recusar um `WHERE` esquecido — ele
simplesmente devolve dados de outra empresa, sem erro.

A defesa aqui é tornar o escopo impossível de esquecer:

1. `TenantScope` é obrigatório na assinatura de todo repositório e toda tool;
2. a conexão aplica `SET LOCAL app.company_id` por transação, para a RLS
   também valer quando a role dedicada estiver configurada;
3. `tests/multitenant/` prova o isolamento por ferramenta.

Uma camada só não basta. As três juntas cobrem: erro de código (1), erro de
configuração (2) e regressão (3).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


class TenantViolationError(Exception):
    """Tentativa de acessar dado fora do escopo da empresa.

    É erro de programação, não condição esperada: nunca deve virar resposta
    HTTP 4xx silenciosa. Estoura, loga e falha o turno.
    """

    def __init__(self, expected: UUID, received: UUID | None, what: str) -> None:
        self.expected = expected
        self.received = received
        self.what = what
        super().__init__(
            f"Violação de tenant em {what}: escopo={expected} recebido={received}"
        )


@dataclass(frozen=True, slots=True)
class TenantScope:
    """Empresa dona da operação, mais o rastro de correlação.

    Frozen porque escopo não se altera no meio de um turno. Se precisar de
    outra empresa, é outro escopo — e aí a troca fica visível no código.
    """

    company_id: UUID
    correlation_id: str | None = None
    actor: str = "ai-service"

    def guard(self, company_id: UUID | None, what: str) -> None:
        """Confere que uma linha lida pertence a esta empresa.

        Usar mesmo quando a query já filtrou. O custo é uma comparação; o que
        ele pega é o caso em que a query mudou e o filtro caiu junto.
        """
        if company_id != self.company_id:
            raise TenantViolationError(self.company_id, company_id, what)

    def guard_all(self, company_ids: list[UUID | None], what: str) -> None:
        for cid in company_ids:
            self.guard(cid, what)


__all__ = ["TenantScope", "TenantViolationError"]
