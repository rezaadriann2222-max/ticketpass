.PHONY: up down logs psql redis reset scale test-load

up:
	docker compose up -d --build
down:
	docker compose down
logs:
	docker compose logs -f api
psql:
	docker compose exec postgres sh -c 'psql -U $$POSTGRES_USER -d $$POSTGRES_DB'
redis:
	docker compose exec redis sh -c 'redis-cli -a $$REDIS_PASSWORD'
reset:
	docker compose down -v && docker compose up -d --build
scale:
	docker compose up -d --scale api=3
test-load:
	docker compose --profile loadtest run --rm k6
