FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git curl xz-utils && rm -rf /var/lib/apt/lists/*

RUN curl -sL "https://github.com/shadowsocks/shadowsocks-rust/releases/download/v1.21.1/shadowsocks-v1.21.1.x86_64-unknown-linux-gnu.tar.xz" -o /tmp/ss.tar.xz && \
  tar xf /tmp/ss.tar.xz -C /tmp/ && \
  cp /tmp/sslocal /usr/local/bin/ && \
  rm -rf /tmp/ss.tar.xz /tmp/sslocal /tmp/ssservice /tmp/ssmanager /tmp/ssurl

COPY package.json package-lock.json* ./
RUN npm install

RUN cd node_modules/minecraft-data && \
  mv minecraft-data minecraft-data-old && \
  git clone -b pc_26_2 https://github.com/PrismarineJS/minecraft-data --depth 1 && \
  node bin/generate_data.js

RUN curl -sL -o /app/node_modules/protodef/src/serializer.js \
  https://raw.githubusercontent.com/extremeheat/node-protodef/refs/heads/dlog/src/serializer.js && \
  curl -sL -o /app/node_modules/protodef/src/compiler.js \
  https://raw.githubusercontent.com/extremeheat/node-protodef/refs/heads/dlog/src/compiler.js

COPY . .
RUN chmod +x start.sh

CMD ["bash", "start.sh"]
