# Build the complete deterministic demo, then serve with no application backend.
FROM node:22.18.0-bookworm-slim AS frontend-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM python:3.11.13-slim-bookworm AS engine
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .
RUN smile-watch build

FROM frontend-deps AS web
COPY web ./web
COPY scripts/build-web.mjs ./scripts/build-web.mjs
COPY --from=engine /app/docs/data ./docs/data
COPY docs/assets/social-preview.png ./docs/assets/social-preview.png
ARG SMILE_WATCH_REPO=https://github.com/PinyaColada/smile-watch
ENV SMILE_WATCH_REPO=$SMILE_WATCH_REPO
RUN npm run build

FROM python:3.11.13-slim-bookworm AS serve
WORKDIR /site
COPY --from=web /app/docs ./
USER 65534:65534
EXPOSE 8080
CMD ["python", "-m", "http.server", "8080", "--bind", "0.0.0.0"]
