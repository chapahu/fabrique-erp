import { app } from "./app";

const port = Number(process.env.API_PORT ?? 3000);

app.listen(port, () => {
  console.log(`API de l'ERP démarrée sur http://localhost:${port}`);
});
