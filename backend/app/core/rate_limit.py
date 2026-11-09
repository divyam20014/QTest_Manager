from slowapi import Limiter
from slowapi.util import get_remote_address

# GAP-16: POST /auth/login had no throttling at all, letting an attacker
# submit unlimited password guesses against a known (tenant_id, email)
# pair -- only the post-login MFA code had a lockout (FR-AUTH-003). Keyed
# by client IP (in-memory storage; no Redis/cache layer is in the approved
# stack) rather than (tenant_id, email), since slowapi's key functions
# inspect the request/connection, not the JSON body, without extra
# plumbing -- IP-based throttling is still a real brute-force mitigation
# and is what the gap's own closing condition names as an acceptable
# option. Revisit with a per-(tenant_id, email) key if this needs
# hardening further than a single-process deployment.
limiter = Limiter(key_func=get_remote_address)
