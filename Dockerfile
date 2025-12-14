# Dockerfile para Railway - Backend NestJS
FROM node:18-alpine

# Definir diretório de trabalho
WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar TODAS as dependências (incluindo devDependencies para build)
RUN npm ci

# Copiar código fonte
COPY . .

# Build da aplicação
RUN npm run build

# Remover devDependencies após build para reduzir tamanho
RUN npm ci --only=production && npm cache clean --force

# Expor porta (Railway usa PORT env var)
EXPOSE $PORT

# Comando para iniciar a aplicação
CMD ["npm", "run", "start:prod"]
