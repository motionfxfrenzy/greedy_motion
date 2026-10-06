# Load operator CLI credentials for one VideoSaaS environment into the current shell.
# Usage (must be sourced, bash or zsh):
#   source scripts/videosaas-env.sh staging
#   source scripts/videosaas-env.sh production
#   source scripts/videosaas-env.sh off
# Credentials are read from ~/.config/videosaas/<env>.sh, never from this repository.
# See docs/RUNBOOK_CLI.md.

_videosaas_vars="RAILWAY_TOKEN RAILWAY_API_TOKEN VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID STRIPE_API_KEY SENTRY_AUTH_TOKEN VIDEOSAAS_ENV"

# In zsh, PS1 and PROMPT are the same variable, so only PS1 is touched.
_videosaas_restore_prompt() {
  if [ -n "${_VIDEOSAAS_OLD_PS1+x}" ]; then PS1="$_VIDEOSAAS_OLD_PS1"; unset _VIDEOSAAS_OLD_PS1; fi
}

_videosaas_clear() {
  for _v in $(echo "$_videosaas_vars"); do unset "$_v"; done
  unset _v
  _videosaas_restore_prompt
}

_videosaas_env="${1:-}"
case "$_videosaas_env" in
  staging|production) ;;
  off)
    _videosaas_clear
    echo "VideoSaaS operator credentials cleared."
    unset _videosaas_env _videosaas_vars
    return 0 2>/dev/null || exit 0
    ;;
  *)
    echo "Usage: source scripts/videosaas-env.sh staging|production|off" >&2
    unset _videosaas_env
    return 1 2>/dev/null || exit 1
    ;;
esac

_videosaas_file="$HOME/.config/videosaas/$_videosaas_env.sh"
if [ ! -f "$_videosaas_file" ]; then
  echo "Missing $_videosaas_file. Create it as described in docs/RUNBOOK_CLI.md." >&2
  unset _videosaas_env _videosaas_file
  return 1 2>/dev/null || exit 1
fi

if [ "$_videosaas_env" = production ]; then
  printf 'Type "production" to load PRODUCTION credentials: '
  read -r _videosaas_confirm
  if [ "$_videosaas_confirm" != production ]; then
    echo "Cancelled."
    unset _videosaas_env _videosaas_file _videosaas_confirm
    return 1 2>/dev/null || exit 1
  fi
  unset _videosaas_confirm
fi

_videosaas_clear
# shellcheck disable=SC1090
. "$_videosaas_file"
export VIDEOSAAS_ENV="$_videosaas_env"

if [ "$_videosaas_env" = production ]; then _videosaas_label="[PRODUCTION] "; else _videosaas_label="[$_videosaas_env] "; fi
_VIDEOSAAS_OLD_PS1="${PS1-}"; PS1="$_videosaas_label${PS1-}"

echo "Loaded VideoSaaS $_videosaas_env operator credentials from $_videosaas_file."
unset _videosaas_env _videosaas_file _videosaas_label
