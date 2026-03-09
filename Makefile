.PHONY: docker-up demo

docker-up:
	docker compose up -d --build

demo: docker-up
	./examples/demo/run_demo.sh
