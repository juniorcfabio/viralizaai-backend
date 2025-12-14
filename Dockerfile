# Dockerfile para Railway - Backend NestJS
FROM node:18-alpine

# Definir diretório de trabalho
WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código fonte
COPY . .

# Build da aplicação
RUN npm run build

# Expor porta (Railway usa PORT env var)
EXPOSE $PORT

# Comando para iniciar a aplicação
CMD ["npm", "run", "start:prod"]
