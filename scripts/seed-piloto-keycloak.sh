#!/usr/bin/env bash
# Seed de usuarios Keycloak para el hotel piloto.
# Crea 9 usuarios en el realm 'pms' con tenant_id = PILOTO_TENANT_ID y los
# roles correspondientes. Idempotente — re-ejecutar es seguro (409 = ya existe).
#
# Requiere:
#   - jq, curl, openssl en PATH
#   - KEYCLOAK_ADMIN_PASSWORD seteado en env
#
# Uso:
#   KEYCLOAK_ADMIN_PASSWORD=AdminPiloto2026 bash scripts/seed-piloto-keycloak.sh

set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-https://pms-keycloak.fly.dev}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD must be set}"
REALM="pms"
PILOTO_TENANT_ID="22222222-2222-2222-2222-222222222222"
PILOTO_PASSWORD_DEFAULT="${PILOTO_PASSWORD_DEFAULT:-Piloto2026}"
NOTIF_EMAIL="${NOTIF_EMAIL:-elouaryachi.outman@gmail.com}"

TOKEN=$(curl -sS -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=admin-cli&username=$KEYCLOAK_ADMIN&password=$ADMIN_PASS" \
  | jq -r '.access_token')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "Failed to obtain admin token" >&2
  exit 1
fi
echo "Admin token OK (len=${#TOKEN})"

# Cada user: email | first | last | roles_csv
USERS=(
  "recepcion1@berenjena-demo.local|Maria|Recepcion|front_desk"
  "recepcion2@berenjena-demo.local|Carlos|Recepcion|front_desk"
  "recepcion3@berenjena-demo.local|Ana|Recepcion|front_desk"
  "nightaudit@berenjena-demo.local|Luis|NightAuditor|night_auditor,front_desk"
  "hsk-supervisor@berenjena-demo.local|Pilar|Supervisor|housekeeping_supervisor"
  "hsk1@berenjena-demo.local|Rosa|Housekeeper|housekeeper"
  "hsk2@berenjena-demo.local|Ines|Housekeeper|housekeeper"
  "hsk3@berenjena-demo.local|Miguel|Housekeeper|housekeeper"
  "hsk4@berenjena-demo.local|Andrea|Housekeeper|housekeeper"
)

create_user_payload() {
  local email="$1" first="$2" last="$3"
  jq -n \
    --arg email "$email" \
    --arg first "$first" \
    --arg last "$last" \
    --arg pass "$PILOTO_PASSWORD_DEFAULT" \
    --arg tid "$PILOTO_TENANT_ID" \
    '{
      username: $email,
      email: $email,
      firstName: $first,
      lastName: $last,
      enabled: true,
      emailVerified: true,
      attributes: { tenant_id: [$tid] },
      credentials: [{ type: "password", value: $pass, temporary: false }]
    }'
}

for entry in "${USERS[@]}"; do
  IFS='|' read -r email first last roles <<<"$entry"
  echo "─── Provisioning $email ($roles)"

  payload=$(create_user_payload "$email" "$first" "$last")
  status=$(curl -sS -o /tmp/kc-create.json -w "%{http_code}" -X POST \
    "$KEYCLOAK_URL/admin/realms/$REALM/users" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload")

  if [[ "$status" != "201" && "$status" != "409" ]]; then
    echo "  ERROR creating user (HTTP $status):" >&2
    cat /tmp/kc-create.json >&2
    exit 1
  fi

  if [[ "$status" == "409" ]]; then
    echo "  User exists, updating attributes/password"
    user_id=$(curl -sS "$KEYCLOAK_URL/admin/realms/$REALM/users?username=$email&exact=true" \
      -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')
    curl -sS -X PUT "$KEYCLOAK_URL/admin/realms/$REALM/users/$user_id" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$payload" >/dev/null
  else
    user_id=$(curl -sS "$KEYCLOAK_URL/admin/realms/$REALM/users?username=$email&exact=true" \
      -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')
  fi

  # Asignar realm roles
  IFS=',' read -ra role_list <<<"$roles"
  role_payload="["
  first_role=true
  for r in "${role_list[@]}"; do
    role_obj=$(curl -sS "$KEYCLOAK_URL/admin/realms/$REALM/roles/$r" \
      -H "Authorization: Bearer $TOKEN" | jq -c '{id, name}')
    if [[ -z "$role_obj" || "$role_obj" == "null" ]]; then
      echo "  WARN role '$r' not found in realm — skipping" >&2
      continue
    fi
    if [[ "$first_role" == "true" ]]; then
      first_role=false
    else
      role_payload+=","
    fi
    role_payload+="$role_obj"
  done
  role_payload+="]"

  curl -sS -X POST "$KEYCLOAK_URL/admin/realms/$REALM/users/$user_id/role-mappings/realm" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$role_payload" >/dev/null

  echo "  ✓ $email provisioned (id=$user_id)"
done

echo
echo "════════════════════════════════════════════════════════════"
echo "PILOTO USERS PROVISIONED"
echo "Tenant ID: $PILOTO_TENANT_ID"
echo "Default password: $PILOTO_PASSWORD_DEFAULT"
echo "Notif email para alertas: $NOTIF_EMAIL"
echo "Login en: https://pms-web-fo.fly.dev/  o  https://pms-web-hsk.fly.dev/"
echo "════════════════════════════════════════════════════════════"
echo "USUARIOS:"
for entry in "${USERS[@]}"; do
  IFS='|' read -r email _ _ roles <<<"$entry"
  echo "  $email ($roles)"
done
