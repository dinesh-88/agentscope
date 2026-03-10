.PHONY: docker-up demo

docker-up:
	docker compose -f docker/docker-compose.yml up -d --build

demo: docker-up
	./examples/demo-agent/run_demo.sh
