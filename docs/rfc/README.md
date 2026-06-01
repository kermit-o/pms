# Aubergine PMS · RFC Index

> Request for Comments / Technical Design Documents. Uno o varios por
> PRD. El proceso vive en [`docs/PROCESS.md`](../PROCESS.md).
> El template está en [`_template.md`](./_template.md).

| # | Título | Status | PRD |
|---|---|---|---|
| _aún ninguno — el primero será al iniciar la próxima feature_ | | | |

---

## Cómo añadir un RFC nuevo

1. Comprobar que el PRD referenciado existe y está `Approved`.
2. Copiar `_template.md` a `NNN-slug.md` con el siguiente número libre.
3. Rellenar el template completo (todas las secciones obligatorias).
4. Abrir PR — el PR contiene SOLO el documento RFC.
5. Revisión con `docs/REVIEW-CHECKLIST.md §B`.
6. Al mergear, el PR del RFC habilita los PRs de implementación.
7. Cada PR de implementación referencia este RFC en al menos un commit.
