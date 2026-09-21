"""Roteamento por classe de modelo.

Quatro classes, não N modelos espalhados pelo código. Trocar de provider vira
mudança de variável de ambiente, não caça a string literal.

A regra de escolha é grosseira de propósito: quase tudo em FAST, e SMART só
quando o turno tem negociação ou objeção. Em atendimento comercial a maior
parte dos turnos é "tem de 6 metros?" — mandar isso para o modelo caro é
desperdício que aparece na fatura no fim do mês.
"""

from __future__ import annotations

from enum import StrEnum

from app.config import settings


class ModelClass(StrEnum):
    FAST = "fast"
    SMART = "smart"
    VISION = "vision"
    EMBEDDING = "embedding"


def model_for(cls: ModelClass) -> str:
    return {
        ModelClass.FAST: settings.llm_fast_model,
        ModelClass.SMART: settings.llm_smart_model,
        ModelClass.VISION: settings.llm_vision_model,
        ModelClass.EMBEDDING: settings.llm_embedding_model,
    }[cls]


def fallback_for(cls: ModelClass) -> str | None:
    value = {
        ModelClass.FAST: settings.llm_fast_fallback,
        ModelClass.SMART: settings.llm_smart_fallback,
    }.get(cls, "")
    return value or None


# Sinais de que o turno saiu de informação e entrou em negociação.
_SMART_SIGNALS = (
    "desconto",
    "negocia",
    "parcel",
    "caro",
    "concorrent",
    "fechar hoje",
    "melhor preço",
    "abatimento",
)


def classify_turn(last_lead_message: str, *, has_objections: bool = False) -> ModelClass:
    """Escolhe a classe para um turno de vendas."""
    if has_objections:
        return ModelClass.SMART
    text = last_lead_message.lower()
    if any(signal in text for signal in _SMART_SIGNALS):
        return ModelClass.SMART
    return ModelClass.FAST


__all__ = ["ModelClass", "classify_turn", "fallback_for", "model_for"]
