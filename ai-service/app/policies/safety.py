"""Camada de segurança de texto.

Porte direto de `runSafetyLayer` (`src/lib/ai-agent.server.ts:238-267`). Foi
mantida em vez de substituída de propósito: é um filtro barato que já pegou
casos reais em produção, e o Policy Engine novo resolve outro problema
(autorizar ação), não este (o modelo escreveu algo que não podia).

Limitação conhecida e assumida: é regex. Não entende paráfrase — "faço por
menos" passa, "dou 10%" não. Ela reduz risco, não o elimina; o aterramento de
fato vem das tools.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# "10%", "10 %", "10,5%" — o \s* cobre o espaço que o modelo às vezes insere.
PERCENTAGE_PATTERN = re.compile(r"\d{1,3}(?:[.,]\d{1,2})?\s*%")

SAFETY_BLOCK_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bgarant(?:o|imos)\b.*\bmenor preço\b", re.I), "garantia de menor preço"),
    (re.compile(r"\bfa(?:ço|zemos)\s+por\s+R?\$?\s*\d", re.I), "preço negociado fora da tabela"),
    (re.compile(r"\bfrete\s+gr[áa]tis\b", re.I), "frete grátis não cadastrado"),
    (re.compile(r"\bbrinde\b", re.I), "brinde não cadastrado"),
    (re.compile(r"\bdesconto\s+(?:especial|exclusivo)\b", re.I), "desconto especial"),
    (re.compile(r"\bparcel\w*\s+sem\s+juros\b", re.I), "condição de parcelamento não oficial"),
]


@dataclass(frozen=True, slots=True)
class SafetyVerdict:
    ok: bool
    reason: str | None = None


def _canonical_percentage(value: str) -> str:
    """Normaliza para comparar '10%', '10 %' e '10,0%' como a mesma coisa."""
    digits = value.replace(" ", "").replace("%", "").replace(",", ".")
    try:
        return f"{float(digits):g}"
    except ValueError:
        return digits


def check_message(message: str, commercial_terms: str | None) -> SafetyVerdict:
    """Valida o texto que sairia para o cliente.

    Percentual só passa se estiver literalmente registrado nos termos
    comerciais da empresa. Um número que o modelo produziu sozinho é, por
    definição, não aterrado.
    """
    if not message.strip():
        return SafetyVerdict(ok=False, reason="safety_block: mensagem vazia")

    registered = {
        _canonical_percentage(p) for p in PERCENTAGE_PATTERN.findall(commercial_terms or "")
    }
    for found in PERCENTAGE_PATTERN.findall(message):
        if _canonical_percentage(found) not in registered:
            return SafetyVerdict(
                ok=False, reason="safety_block: percentual/desconto não registrado"
            )

    for pattern, reason in SAFETY_BLOCK_PATTERNS:
        if pattern.search(message):
            return SafetyVerdict(ok=False, reason=f"safety_block: {reason}")

    return SafetyVerdict(ok=True)


__all__ = ["PERCENTAGE_PATTERN", "SAFETY_BLOCK_PATTERNS", "SafetyVerdict", "check_message"]
