.PHONY: help start setup infra up down migrate demo clean

help:
	@echo "================================================================"
	@echo "SynapseHub Makefile"
	@echo "================================================================"
	@echo "  make start    - Run the start.sh script to launch everything locally"
	@echo "  make setup    - Copy .env.example to .env and install dependencies"
	@echo "  make infra    - Start infrastructure (PostgreSQL, MinIO) via Docker"
	@echo "  make up       - Start the entire stack (including app) via Docker Compose"
	@echo "  make down     - Stop all Docker containers"
	@echo "  make migrate  - Run database migrations"
	@echo "  make demo     - Run the E2E demo scenario"
	@echo "  make clean    - Remove node_modules, dist, and destroy Docker volumes"

# Run the provided bash script to start everything automatically
start:
	./start.sh

# Setup environment
setup:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env file."; fi
	npm install

# Start only the infrastructure backing services
infra:
	docker compose up -d postgres minio minio-init

# Start the full stack in Docker (app + infra)
up: setup
	docker compose up --build -d
	@echo "Stack is running. API is available at http://localhost:3777"

# Stop all docker containers
down:
	docker compose down

# Run database migrations manually
migrate: infra
	@echo "Waiting for database to be ready..."
	@sleep 5
	npm run db:migrate

# Run the demo script
demo:
	npm run demo

# Clean up local environment and docker volumes
clean: down
	rm -rf node_modules dist
	docker compose down -v
