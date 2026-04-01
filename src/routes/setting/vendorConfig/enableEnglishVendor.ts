import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    id: z.string(),
  }),
  async (req, res) => {
    const { id, enableEnglish } = req.body;
    await u.db("o_vendorConfig").where("id", id).update({
      enableEnglish,
    });
    res.status(200).send(success("更新成功"));
  },
);
