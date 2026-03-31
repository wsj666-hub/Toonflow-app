import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { useSkill } from "@/utils/agent/skillsTools";
import { tool } from "ai";
import { o_script } from "@/types/database";

const router = express.Router();

/** 新资产：AI 首次识别到的资产，需要完整信息 */
const NewAssetSchema = z.object({
  name: z.string().describe("资产名称,仅为名称不做其他任何表述"),
  desc: z.string().describe("资产描述"),
  type: z.enum(["role", "tool", "scene"]).describe("资产类型"),
  scriptIds: z.array(z.number()).describe("使用该资产的剧本id数组"),
});

/** 已有资产：数据库中已存在的资产，只需给出名称和关联的剧本 */
const ExistingAssetRefSchema = z.object({
  name: z.string().describe("已有资产的名称,必须与已有资产列表中的名称完全一致"),
  scriptIds: z.array(z.number()).describe("使用该资产的剧本id数组"),
});

export const AssetSchema = z.object({
  name: z.string().describe("资产名称,仅为名称不做其他任何表述"),
  desc: z.string().describe("资产描述"),
  type: z.enum(["role", "tool", "scene"]).describe("资产类型"),
});

type NewAsset = z.infer<typeof NewAssetSchema>;
type ExistingAssetRef = z.infer<typeof ExistingAssetRefSchema>;
type Asset = z.infer<typeof AssetSchema>;

/** 每批 AI 调用的结果 */
type GroupResult = {
  batchScriptIds: number[];
  newAssets: NewAsset[];
  existingRefs: ExistingAssetRef[];
} | null;

/** 将 scriptIds 数组按 groupSize 分组 */
function chunkArray<T>(arr: T[], groupSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += groupSize) {
    chunks.push(arr.slice(i, i + groupSize));
  }
  return chunks;
}

export default router.post(
  "/",
  validateFields({
    scriptIds: z.array(z.number()),
    projectId: z.number(),
    groupSize: z.number().min(1).max(10).optional(),
  }),
  async (req, res) => {
    const { scriptIds, projectId, groupSize = 5 } = req.body;
    if (!scriptIds.length) return res.status(400).send(error("请先选择剧本"));
    const scripts = await u.db("o_script").whereIn("id", scriptIds);
    const intansce = u.Ai.Text("universalAi");

    // 查询已有的剧本-资产关联，找出已经提取过资产的剧本
    const existingScriptAssets = await u.db("o_scriptAssets").whereIn("scriptId", scriptIds).select("scriptId");
    const scriptIdsWithAssets = new Set(existingScriptAssets.map((sa: any) => sa.scriptId));

    // 构建 scriptId -> script 内容的映射
    const scriptMap = new Map(scripts.map((s: o_script) => [s.id, s]));

    // 过滤掉已成功提取过资产的剧本（extractState === 1 且有关联资产）
    const filteredScriptIds = scriptIds.filter((id: number) => {
      const script = scriptMap.get(id);
      return !(script?.extractState === 1 && scriptIdsWithAssets.has(id));
    });
    const skippedCount = scriptIds.length - filteredScriptIds.length;

    if (!filteredScriptIds.length) {
      return res.send(success("所有剧本已提取过资产，无需重复提取"));
    }

    await u.db("o_script").whereIn("id", filteredScriptIds).update({
      extractState: 0,
    });

    const errors: { scriptId: number; error: string }[] = [];
    let successCount = 0;

    // 将过滤后的 scriptIds 按 groupSize（默认5）分组，每组一起发给 AI
    const scriptGroups = chunkArray(filteredScriptIds, groupSize);

    /** 一组剧本提取完成后统一入库并建立关联 */
    async function persistGroupResult(result: GroupResult) {
      if (!result) return;
      const { batchScriptIds, newAssets, existingRefs } = result;
      if (!newAssets.length && !existingRefs.length) return;

      // 查询已有资产
      const existingAssets = await u.db("o_assets").where("projectId", projectId).select("id", "name");
      const existingMap = new Map(existingAssets.map((a) => [a.name!, a.id!]));

      // 插入新资产（不在已有列表中的）
      const toInsert = newAssets.filter((asset) => !existingMap.has(asset.name));
      if (toInsert.length) {
        await u.db("o_assets").insert(
          toInsert.map((asset) => ({
            name: asset.name,
            type: asset.type,
            describe: asset.desc,
            projectId: projectId,
            startTime: Date.now(),
          })),
        );
      }

      // 重新查询获取完整的 name -> id 映射
      const allAssets = await u.db("o_assets").where("projectId", projectId).select("id", "name");
      const nameToId = new Map(allAssets.map((a) => [a.name, a.id]));

      // 收集所有资产与剧本的关联关系
      const scriptAssetRows: { scriptId: number; assetId: number }[] = [];

      // 新资产的关联
      for (const asset of newAssets) {
        const assetId = nameToId.get(asset.name);
        if (assetId) {
          for (const sid of asset.scriptIds) {
            scriptAssetRows.push({ scriptId: sid, assetId });
          }
        }
      }

      // 已有资产的关联
      for (const ref of existingRefs) {
        const assetId = nameToId.get(ref.name);
        if (assetId) {
          for (const sid of ref.scriptIds) {
            scriptAssetRows.push({ scriptId: sid, assetId });
          }
        }
      }

      // 先删除本批 scriptId 的旧关联，再插入新的
      await u.db("o_scriptAssets").whereIn("scriptId", batchScriptIds).delete();
      if (scriptAssetRows.length) {
        await u.db("o_scriptAssets").insert(scriptAssetRows);
      }

      // 本批成功的剧本状态更新为 1（成功）
      await u.db("o_script").whereIn("id", batchScriptIds).update({
        extractState: 1,
        errorReason: null,
      });
    }

    // 逐组处理（每组最多 groupSize 集剧本一起发给 AI）
    for (const group of scriptGroups) {
      // 过滤有效剧本
      const validScripts: { id: number; script: o_script }[] = [];
      for (const scriptId of group as number[]) {
        const script = scriptMap.get(scriptId);
        if (!script) {
          errors.push({ scriptId, error: "未找到对应剧本" });
          await u.db("o_script").where("id", scriptId).update({ extractState: -1, errorReason: "未找到对应剧本" });
        } else {
          validScripts.push({ id: scriptId, script });
        }
      }
      if (!validScripts.length) continue;

      // 查询当前项目已有的资产列表，提供给 AI 参考
      const existingAssets = await u.db("o_assets").where("projectId", projectId).select("name", "type");
      const existingAssetsList = existingAssets.map((a) => `${a.name}(${a.type})`).join("、");

      // 拼接多集剧本内容，每集用分隔标记
      const scriptsContent = validScripts
        .map(({ id, script }) => `===== 【剧本ID: ${id}】${script.name || ""} =====\n${script.content}`)
        .join("\n\n");

      const validScriptIds = validScripts.map((v) => v.id);

      // 用闭包收集 AI 返回的资产
      let collectedNew: NewAsset[] = [];
      let collectedExisting: ExistingAssetRef[] = [];

      const resultTool = tool({
        description: "返回结果时必须调用这个工具",
        inputSchema: z.object({
          newAssets: z
            .array(NewAssetSchema)
            .describe("新发现的资产列表（不在已有资产列表中的），需要完整的 prompt、name、desc、type 和使用该资产的 scriptIds"),
          existingAssetRefs: z
            .array(ExistingAssetRefSchema)
            .describe("已有资产的引用列表（在已有资产列表中已存在的），只需给出资产名称和使用该资产的 scriptIds"),
        }),
        execute: async ({ newAssets, existingAssetRefs }) => {
          console.log("[tools] extractAssets result", { newAssets, existingAssetRefs });
          if (newAssets?.length) collectedNew = newAssets;
          if (existingAssetRefs?.length) collectedExisting = existingAssetRefs;
          return "无需回复用户任何内容";
        },
      });

      try {
        const data = await u.db("o_prompt").where("type", "scriptAssetExtraction").first("data");
        const existingHint = existingAssetsList
          ? `\n\n【已有资产列表】：${existingAssetsList}\n对于已有资产，如果在剧本中出现，只需在 existingAssetRefs 中给出资产名称和对应的 scriptIds 数组即可，无需重复生成 desc/type。对于新发现的资产（不在已有列表中），请在 newAssets 中给出完整信息。`
          : "";

        const output = await intansce.invoke({
          messages: [
            {
              role: "system",
              content:
                data?.data +
                "\n\n提取剧本中涉及的资产（角色、场景、道具），参考技能 script_assets_extract 规范，结果必须通过 resultTool 工具返回。" +
                "\n\n注意：本次会同时提供多集剧本，每集剧本以 ===== 【剧本ID: xxx】 ===== 分隔。你需要分析每集剧本使用了哪些资产，并在输出中用 scriptIds 数组标明每个资产在哪些剧本中出现。",
            },
            {
              role: "user",
              content: `当前已有资产列表：${existingHint}\n\n请根据以下${validScripts.length}集剧本提取对应的剧本资产（角色、场景、道具）:\n\n${scriptsContent}`,
            },
          ],
          tools: { resultTool },
        });
        console.log("%c Line:extractAssets 🍧 output", "background:#f5ce50", output.text);
      } catch (e: any) {
        const msg = e?.message || String(e);
        const scriptNames = validScripts.map((v) => v.script.name).join(", ");
        console.error(`[extractAssets] group=[${validScriptIds.join(",")}] 提取失败:`, msg);
        for (const { id, script } of validScripts) {
          errors.push({ scriptId: id, error: (script.name || "") + ":" + u.error(e).message });
          await u
            .db("o_script")
            .where("id", id)
            .update({ extractState: -1, errorReason: u.error(e).message });
        }
        continue;
      }

      if (!collectedNew.length && !collectedExisting.length) {
        for (const { id } of validScripts) {
          errors.push({ scriptId: id, error: "AI 未返回任何资产" });
          await u.db("o_script").where("id", id).update({ extractState: -1, errorReason: "AI 未返回任何资产" });
        }
        continue;
      }

      successCount += validScripts.length;

      // 入库
      await persistGroupResult({
        batchScriptIds: validScriptIds,
        newAssets: collectedNew,
        existingRefs: collectedExisting,
      });
    }

    return res.send(success(skippedCount > 0 ? `开始提取资产，跳过 ${skippedCount} 个已提取的剧本` : "开始提取资产"));
  },
);
