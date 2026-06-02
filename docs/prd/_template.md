# PRD-NNN — Título corto

- **Status:** `Draft` | `Reviewed` | `Approved` | `Shipped` | `Superseded`
- **Author:** PO Outman El Ouary Achi
- **Date:** YYYY-MM-DD
- **Bloque maestro:** referencia al PRD-000 (ej. "Bloque B — Folio")
- **Related:** RFCs / ADRs / PRDs previos que toca
- **Sprint objetivo:** S?? W??

---

## 1 · Problema

Qué le pasa al hotelero/recepcionista hoy. Sin esta feature, ¿qué hace
mal, qué hace doble, qué pierde, qué no puede hacer?

Una historia real del front desk si la hay, no una abstracción.

---

## 2 · Para quién

¿Qué tipo de hotel se beneficia primero?

- Tamaño (habitaciones)
- Tipo (boutique urbano, rural, B&B, ...)
- Complejidad operativa (con/sin restaurante, con/sin grupos, ...)

Si la feature no aplica a todos los hoteles del PRD maestro, dilo
explícitamente.

---

## 3 · Resultado esperado (success criteria)

Cómo sabemos que esto funcionó. Métricas operativas, no técnicas.

Ejemplos buenos:

- "El recepcionista puede dividir un folio en < 30 s sin tocar SQL."
- "100% de los cargos de un grupo llegan al master folio sin intervención."

Ejemplos malos:

- "Tests pasan."
- "La API responde en 200 ms."

---

## 4 · Criterios de aceptación funcionales

Lista enumerada, cada item es un escenario testable de extremo a extremo.

1. Dado X cuando Y entonces Z.
2. ...

Si un criterio no se puede demostrar en una demo de 30 segundos, no es
un criterio de aceptación — es un detalle técnico (va al RFC).

---

## 5 · Fuera de alcance

Qué NO hace esta feature. Explícito. Estas son las cosas que la
siguiente conversación va a pedir "y de paso..." — listarlas evita
scope creep.

- ...

---

## 6 · Dependencias y bloqueos

- Qué PRDs/RFCs/ADRs previos deben estar `Shipped` antes.
- Qué decisiones externas hacen falta (cert FNMT, alta AEAT, ...).
- Qué datos del PO se necesitan.

---

## 7 · Métricas a instrumentar

Qué medimos cuando esto esté en producción para saber si funciona.

- Eventos de negocio (NATS): ...
- KPIs en Grafana: ...
- Logs estructurados: ...

---

## 8 · Riesgos de producto

No técnicos — esos van al RFC. Aquí: ¿qué pasa si el hotelero lo usa
mal? ¿Qué pérdida de datos/dinero/reputación está en juego?

- ...

---

## 9 · Alternativas consideradas

Qué otras formas de resolver el mismo problema se evaluaron y por qué
se descartaron. Si solo se contempló una, dilo.

---

## 10 · Firma

- **PO:** _Outman El Ouary Achi · YYYY-MM-DD_
- **Tech lead (opcional en MVP):** _·_

Sin firma del PO, el PRD no pasa a RFC.

---

_Plantilla v1 — modificar solo vía PR a `docs/prd/_template.md`._
