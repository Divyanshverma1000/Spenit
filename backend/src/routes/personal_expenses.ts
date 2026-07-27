import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";

const router = Router();

// GET /personal_expenses
router.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  try {
    const result = await pool.query(
      `SELECT id, description, amount, currency, category, created_at
       FROM "PersonalExpense"
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /personal_expenses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /personal_expenses
router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { description, amount, category } = req.body;

  if (!description || !amount) {
    res.status(400).json({ error: "description and amount are required" });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO "PersonalExpense" (user_id, description, amount, category)
       VALUES ($1, $2, $3, $4)
       RETURNING id, description, amount, currency, category, created_at`,
      [userId, description, amount, category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /personal_expenses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /personal_expenses/:id
router.delete("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { id } = req.params;

  try {
    const check = await pool.query(
      'SELECT id FROM "PersonalExpense" WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (check.rows.length === 0) {
      res.status(404).json({ error: "Personal expense not found" });
      return;
    }

    await pool.query(
      'UPDATE "PersonalExpense" SET deleted_at = now(), updated_at = now() WHERE id = $1',
      [id]
    );

    res.json({ message: "Deleted", id });
  } catch (err) {
    console.error("DELETE /personal_expenses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
