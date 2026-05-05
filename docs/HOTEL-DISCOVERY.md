# Hotel Discovery — guion para validar Sprint 2

> **Objetivo:** hablar con 2-3 hoteles boutique (30-150 habs) en España **antes
> de cerrar el alcance del MVP Front Office**. Per ADR-007, Foundation
> avanzó en paralelo, pero las features dependen de feedback real.

## A quién buscamos

- **Director(a) o jefe(a) de recepción** de un hotel boutique 30-150 habs.
- Mejor si gestionan ellos mismos el día a día (no cadenas grandes).
- Si están descontentos con su PMS actual → mucho mejor (tienen pain real).
- Si nunca han usado IA → también vale (capturamos resistencia/expectativas).

Un perfil técnico (CTO de cadena pequeña) también vale para validar arquitectura
y disposición a integraciones.

## Cómo presentarse

> "Estoy construyendo un PMS nuevo enfocado en hoteles boutique en España,
> con IA integrada desde el día uno. No vengo a venderte nada; necesito
> entender vuestro día a día para no construir cosas equivocadas. ¿Te puedo
> robar 45 minutos cuando te venga bien?"

## Estructura de la conversación (45-60 min)

### 1. Operativa actual (15 min)

- ¿Qué PMS usas hoy? ¿Cuánto tiempo llevas con él?
- ¿Qué te gusta? ¿Qué te frustra?
- En una mañana típica, ¿qué hace recepción? ¿Y la gobernanta?
- ¿Cuánto tarda un check-in? ¿Y un check-out?
- ¿Quién hace el Night Audit? ¿Cuánto tiempo tarda?
- ¿Qué reportes mira el director cada día?

### 2. Pain points concretos (15 min)

- Describe el peor momento operativo de la última semana.
- ¿Hay tareas que repetís manualmente y os queman?
- ¿Habéis tenido errores de overbooking, doble facturación, room moves
  fallidos? ¿Cómo se detectaron?
- ¿Qué pasa cuando llega un huésped a las 23:00 y la recepcionista de noche
  se ha confundido con la habitación?
- En housekeeping: ¿cómo asignan tareas? ¿Móvil o papel?

### 3. Compliance y regulación ES (5 min)

- ¿Cómo gestionáis SES.HOSPEDAJES hoy? ¿Manualmente o el PMS lo manda?
- ¿Factura electrónica B2B? ¿Veri\*factu? ¿FACE?
- ¿GDPR ha cambiado algo en cómo guardáis datos del huésped?

### 4. Disposición a IA (10 min)

- ¿Habéis probado IA en el hotel (asistente de reviews, chatbot, etc.)?
- Si te ofreciera un asistente que responde reviews automáticamente con
  vuestro tono de marca, ¿lo usarías? ¿Por qué sí/no?
- Si la auditoría nocturna fuera continua y automática (no batch), ¿qué
  riesgo te preocuparía?
- Voice-first para camareras (informar habitaciones por voz desde móvil):
  ¿realista en vuestro hotel?

### 5. Decisión de compra (10 min)

- ¿Quién decide cambiar de PMS? ¿Tú, el dueño, un consultor?
- ¿Qué te haría considerar cambiar? ¿Y qué te bloquearía?
- ¿Cuánto pagas hoy por el PMS (al mes o por habitación)?
- Si te ofreciera un piloto gratuito de 6 meses a cambio de feedback,
  ¿estarías dispuesto a probar en producción real (no en paralelo)?

## Datos a capturar para el plan

Después de cada conversación, escribir aquí mismo en este doc (sección
"Conversaciones") con:

- Nombre del hotel + interlocutor + cargo + fecha.
- 3 pain points top.
- 2 features que dijo "necesito esto".
- 1 feature que dijo "no me sirve / no lo usaría".
- Compliance específico que mencione.
- Disposición a piloto: SÍ / NO / TAL VEZ + condiciones.

## Decisiones que el feedback debe ajustar

Tras 2-3 conversaciones, revisar y posiblemente actualizar:

- **`PROJECT.md` §4.1 (alcance MVP FO)** — quitar features que nadie pidió,
  añadir las que aparezcan repetidas.
- **Prioridad NA vs HSK** — actualmente entrega secuencial NA → HSK; si
  HSK aparece como dolor mayor, invertir.
- **SES.HOSPEDAJES desde día 1 vs V2** — actualmente día 1; confirmar que
  los hoteles consideran esto bloqueante.
- **Pricing por habitación o por valor** — ADR-016 dice "por valor"; validar
  con hoteles si esto les escama o les atrae.
- **Mobile-first HSK como PWA vs nativa** — ADR no decidido. Validar con
  gobernantas reales qué móviles usan y qué prefieren.

Nuevo ADR si hay cambio significativo de rumbo.

## Conversaciones

> Rellenar a medida que se hagan.

### 2026-XX-XX — Hotel <nombre>

- **Interlocutor:** <nombre>, <cargo>
- **Tipo de hotel:** <habs>, <ubicación>, <segmento>
- **PMS actual:** <nombre>
- **Top 3 pain points:**
  1.
  2.
  3.
- **Features que pidió expresamente:**
- **Features que dijo "no":**
- **Compliance específico:**
- **Disposición a piloto:**
- **Notas adicionales:**
