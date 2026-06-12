# Builds the Excalidraw frontend from source: upstream at a pinned ref with
# the vendored self-host patch applied (see excalidraw-selfhost.patch).
# Point EXCALIDRAW_REPO/EXCALIDRAW_REF at a fork carrying the patch as
# commits and the patch application is skipped automatically (it detects the
# patch is already applied via launcher.py's presence).

FROM alpine/git:latest AS source
ARG EXCALIDRAW_REPO=https://github.com/excalidraw/excalidraw.git
ARG EXCALIDRAW_REF=v0.18.1
RUN git clone --depth 1 --branch "$EXCALIDRAW_REF" "$EXCALIDRAW_REPO" /src
COPY excalidraw-selfhost.patch /tmp/
RUN cd /src && \
    if [ -f launcher.py ]; then echo "source already patched, skipping"; \
    else git apply --verbose /tmp/excalidraw-selfhost.patch; fi

# Build steps below mirror the patched tree's own dynamic-env.Dockerfile.
FROM node:24 AS build
WORKDIR /opt/node_app
COPY --from=source /src .
RUN yarn --network-timeout 600000
ARG NODE_ENV=production
# Swap Vite's build-time env for the runtime window._env_ object that
# launcher.py injects at container start.
RUN sed -i 's/import.meta.env/window._env_/g' $(grep 'import.meta.env' -R -l --include "*.ts" --include "*.tsx" --exclude-dir node_modules .)
RUN yarn build:app:docker

FROM nginx:1.27-alpine
RUN apk add --no-cache bash python3
COPY --from=build /opt/node_app/excalidraw-app/build /usr/share/nginx/html
COPY --from=source /src/launcher.py /
HEALTHCHECK CMD wget -q -O /dev/null http://localhost || exit 1
EXPOSE 80
CMD ["python3", "/launcher.py", "/usr/share/nginx/html"]
