.PHONY: up down logs migrate seed

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

# Migrations run automatically on api container startup (see
# backend/Dockerfile); this target is for re-running them manually,
# e.g. after pulling new migrations without rebuilding.
migrate:
	docker compose exec api alembic upgrade head

# Bootstrap the first platform administrator (ADR-008). Not exposed over
# HTTP by design; usage: make seed EMAIL=owner@qtesthub.local PASSWORD=ChangeMe123!
seed:
	docker compose exec api python -m scripts.seed_platform_admin --email $(EMAIL) --password $(PASSWORD)
