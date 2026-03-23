import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { scriptId } = req.body;
    const storyboardData = await u.db("o_storyboard").where({ scriptId });
    const data = await Promise.all(
      storyboardData.map(async (i) => {
        return {
          ...i,
          title: i.title,
          filePath: i.filePath ? await u.oss.getFileUrl(i.filePath!) : "",
        };
      }),
    );
    res.status(200).send(success(data));
  },
);
