.PHONY: docker-up

docker-up:
	docker compose -f docker/docker-compose.yml up -d --build
