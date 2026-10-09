PYTHON ?= python3.11
VENV = .venv/bin

.PHONY: setup run build plots test lint web serve
setup:
	$(PYTHON) -m venv .venv
	$(VENV)/pip install -r requirements-dev.lock
	$(VENV)/pip install --no-deps -e '.[dev,ibkr]'
	npm ci

build:
	$(VENV)/smile-watch build
	npm run build

plots:
	$(VENV)/python scripts/plots.py

run: build
	$(VENV)/python -m http.server 8080 --directory docs --bind 127.0.0.1

serve:
	$(VENV)/python -m http.server 8080 --directory docs --bind 127.0.0.1

test:
	$(VENV)/pytest -q

lint:
	$(VENV)/ruff check src tests scripts
	$(VENV)/ruff format --check src tests scripts

web:
	npm run build
