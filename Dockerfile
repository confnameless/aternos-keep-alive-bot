FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git curl shadowsocks-libev && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

# Patch minecraft-data with 26.2 data
RUN cd node_modules/minecraft-data && \
  mv minecraft-data minecraft-data-old && \
  git clone -b pc_26_2 https://github.com/PrismarineJS/minecraft-data --depth 1 && \
  node bin/generate_data.js

# Patch protodef for 26.2
RUN curl -sL -o node_modules/protodef/src/serializer.js \
  https://raw.githubusercontent.com/extremeheat/node-protodef/refs/heads/dlog/src/serializer.js && \
  curl -sL -o node_modules/protodef/src/compiler.js \
  https://raw.githubusercontent.com/extremeheat/node-protodef/refs/heads/dlog/src/compiler.js

COPY . .

EXPOSE 7860

RUN chmod +x start.sh

CMD ["./start.sh"]
