import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    inputValues: z.record(z.string(), z.string()),
    inputs: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(["text", "password", "url"]),
        required: z.boolean(),
        placeholder: z.string().optional(),
      }),
    ),
    models: z.array(
      z.discriminatedUnion("type", [
        z.object({
          name: z.string(),
          modelName: z.string(),
          type: z.literal("text"),
          think: z.boolean(),
        }),
        z.object({
          name: z.string(),
          modelName: z.string(),
          type: z.literal("image"),
          mode: z.array(z.enum(["text", "singleImage", "multiReference"])),
          associationSkills: z.string().optional(),
        }),
        z.object({
          name: z.string(),
          modelName: z.string(),
          type: z.literal("video"),
          mode: z.array(
            z.union([
              z.enum(["singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional", "text"]),
              z.array(z.enum(["audioReference", "videoReference", "textReference", "imageReference"])),
            ]),
          ),
          associationSkills: z.string().optional(),
          audio: z.union([z.literal("optional"), z.boolean()]),
          durationResolutionMap: z.array(
            z.object({
              duration: z.array(z.number()),
              resolution: z.array(z.string()),
            }),
          ),
        }),
      ]),
    ),
  }),
  async (req, res) => {
    const { id, models, inputs, inputValues } = req.body;

    await u
      .db("o_vendorConfig")
      .where("id", id)
      .update({
        inputs: JSON.stringify(inputs),
        inputValues: JSON.stringify(inputValues),
        models: JSON.stringify(models),
        enable: 0,
      });
    res.status(200).send(success("更新成功"));
  },
);
