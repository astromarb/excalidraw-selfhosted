FROM node:24-alpine
WORKDIR /app
COPY server.js index.html ./
ENV DATA_FILE=/data/boards.json
EXPOSE 8080
HEALTHCHECK CMD wget -q -O /dev/null http://localhost:8080/boards/ || exit 1
CMD ["node", "server.js"]
