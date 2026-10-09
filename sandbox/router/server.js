import http from "node:http";
import app from "./src/app.js";

const server = http.createServer(app);

server.listen(3000, "0.0.0.0", () => {
    console.log('sandbox router server is running on port 3000')
})