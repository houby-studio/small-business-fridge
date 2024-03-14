import { Router } from "express";
import { ensureAuthenticatedAPI } from "../../functions/ensureAuthenticatedAPI.js";
var router = Router();

// GET /api/scannerValidate - Validates connection when setting up scanner
router.get("/", ensureAuthenticatedAPI, function (req, res, _next) {
  res.set("Content-Type", "application/json");
  res.status(200);
  res.json("OK");
});

export default router;
