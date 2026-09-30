import app from "./src/app.js";
import "dotenv/config";
app.listen(3000, "0.0.0.0", () => {
    console.log("AI orchestration Server is running on port 3000")
})