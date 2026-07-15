FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl xz-utils && rm -rf /var/lib/apt/lists/*

RUN curl -sL "https://github.com/shadowsocks/shadowsocks-rust/releases/download/v1.21.1/shadowsocks-v1.21.1.x86_64-unknown-linux-gnu.tar.xz" -o /tmp/ss.tar.xz && \
  tar xf /tmp/ss.tar.xz -C /tmp/ && \
  cp /tmp/sslocal /usr/local/bin/ && \
  rm -rf /tmp/ss.tar.xz /tmp/sslocal /tmp/ssservice /tmp/ssmanager /tmp/ssurl

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN chmod +x start.sh

CMD ["bash", "start.sh"]
