import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from "@tailwindcss/vite"
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss()],
  server:{
    cors:{
      origin: /^https?:\/\/(?:.+\.)?localhost(?::\d+)?$/  
    },
    proxy:{
      "/api":{
        target:"http://localhost",
        changeOrigin: true,
        secure:false

      }
    }
  }
})
