# Pruebas de integración

Estas pruebas hablan con un Odoo real por XML-RPC. Comprueban lo que las
pruebas unitarias no pueden: que los nombres de campo existan en la versión de
Odoo que uses, que la autenticación con API key funcione de verdad y que los
dominios que construimos sean válidos.

## Arrancar un Odoo desechable

```bash
docker compose -f test/integration/docker-compose.yml up -d
```

La primera vez tarda varios minutos: descarga la imagen e inicializa la base de
datos con datos de demostración. Está listo cuando `docker compose logs odoo`
muestra `HTTP service (werkzeug) running`.

## Ejecutar

```bash
export ODOO_URL=http://localhost:8069
export ODOO_DB=odoo_test
export ODOO_USER=admin
export ODOO_PASSWORD=admin
npm run test:integration
```

Sin esas variables el conjunto se salta entero en vez de fallar, para que
`npm test` siga siendo verde en una máquina sin Docker.

Apuntando a otra instancia se prueba contra tu versión real de Odoo:

```bash
ODOO_URL=https://miempresa.odoo.com ODOO_DB=produccion \
ODOO_USER=bot@empresa.com ODOO_API_KEY=... npm run test:integration
```

Las pruebas solo leen; no crean ni modifican registros, así que apuntarlas a
producción es seguro. Aun así, usa una instancia de pruebas si puedes.

## Limpiar

```bash
docker compose -f test/integration/docker-compose.yml down -v
```
