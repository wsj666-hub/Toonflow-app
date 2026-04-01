import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    trackId: z.number(),
    projectId: z.number(),
    prompt: z.array(z.string()),
    model: z.string(),
  }),
  async (req, res) => {
    const { trackId, projectId, prompt, model } = req.body;
    const [id, modelData] = model.split(":");
    const projectData = await u.db("o_project").select("*").where({ id: projectId }).first();
    const videoPrompt = await u.db("o_prompt").where("type", "videoPromptGeneration").first();
    const artStyle = projectData?.artStyle || "无";
    const visualManual = u.getArtPrompt(artStyle, "art_storyboard_video");
    const { text } = await u.Ai.Text("universalAi").invoke({
      system: `${videoPrompt?.data},${visualManual}`,
      messages: [
        {
          role: "user",
          content: `你是一个专业的${modelData}视频生成助手。请根据以下提示词，生成一段完整的、可直接用于视频生成模型的中文提示词。${prompt.join(
            ",",
          )}`,
        },
      ],
    });
    await u.db("o_videoTrack").where({ id: trackId }).update({
      prompt: text,
    });
    res.status(200).send(success(text));
  },
);
