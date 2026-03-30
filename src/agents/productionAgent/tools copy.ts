import { tool, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";
import u from "@/utils";
import { urlToBase64 } from "@/utils/vm";
export const deriveAssetSchema = z.object({
  id: z.number().describe("衍生资产ID,如果新增则为空"),
  assetsId: z.number().describe("关联的资产ID"),
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("衍生资产名称"),
  desc: z.string().describe("衍生资产描述"),
  src: z.string().nullable().describe("衍生资产资源路径"),
  state: z.enum(["未生成", "生成中", "已完成", "生成失败"]).describe("衍生资产生成状态"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("衍生资产类型"),
});
export const assetItemSchema = z.object({
  id: z.number().describe("资产唯一标识"),
  name: z.string().describe("资产名称"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("资产类型"),
  prompt: z.string().describe("生成提示词"),
  desc: z.string().describe("资产描述"),
  derive: z.array(deriveAssetSchema).describe("衍生资产列表"),
});
export const storyboardSchema = z.object({
  id: z.number().describe("分镜ID，必须为真实id"),
  title: z.string().describe("分镜标题"),
  description: z.string().describe("分镜描述"),
  camera: z.string().describe("镜头信息"),
  duration: z.number().describe("持续时长(秒)"),
  frameMode: z.enum(["firstFrame", "endFrame", "linesSoundEffects"]).describe("帧模式: 首帧/尾帧/台词音效"),
  prompt: z.string().describe("生成提示词"),
  lines: z.string().nullable().describe("台词内容"),
  sound: z.string().nullable().describe("音效内容"),
  mode: z
    .union([
      z.enum(["singleImage", "multiImage", "gridImage", "startEndRequired", "endFrameOptional", "startFrameOptional", "text"]),
      z.array(z.enum(["video", "image", "audio", "text"])),
    ])
    .describe("视频模式"),
  associateAssetsIds: z.array(z.number()).describe("关联资产ID列表"),
  src: z.string().nullable().describe("分镜资源路径"),
});
export const workbenchDataSchema = z.object({
  name: z.string().describe("项目名称"),
  duration: z.string().describe("视频时长"),
  resolution: z.string().describe("分辨率"),
  fps: z.string().describe("帧率"),
  cover: z.string().optional().describe("封面图片路径"),
  gradient: z.string().optional().describe("渐变色配置"),
});
export const posterItemSchema = z.object({
  id: z.number().describe("海报ID"),
  image: z.string().describe("海报图片路径"),
});
export const flowDataSchema = z.object({
  script: z.string().describe("剧本内容"),
  scriptPlan: z.string().describe("拍摄计划"),
  assets: z.array(assetItemSchema).describe("衍生资产"),
  storyboardTable: z.string().describe("分镜表"),
  storyboard: z.array(storyboardSchema).describe("分镜面板"),
  workbench: workbenchDataSchema.describe("工作台配置"),
  poster: z
    .object({
      items: z.array(posterItemSchema).describe("海报项目列表"),
    })
    .describe("海报配置"),
});

export type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.enum(Object.keys(flowDataSchema.shape) as [keyof FlowData, ...Array<keyof FlowData>]);
const flowDataKeyLabels = Object.fromEntries(
  Object.entries(flowDataSchema.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof FlowData, string>;

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;
  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: z.object({
        key: keySchema.describe("数据key"),
      }),
      execute: async ({ key }) => {
        const thinking = msg.thinking(`正在获取${flowDataKeyLabels[key]}工作区数据...`);
        console.log("[tools] get_flowData", key);
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        thinking.appendText(`获取到${flowDataKeyLabels[key]}:\n` + flowData[key]);
        thinking.updateTitle(`获取${flowDataKeyLabels[key]}完成`);
        thinking.complete();
        return flowData[key];
      },
    }),
    set_flowData_script: tool({
      description: "保存剧本内容到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.script }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData script", value);
        const thinking = msg.thinking("正在保存 剧本 数据");
        socket.emit("setFlowData", { key: "script", value });
        thinking.updateTitle("保存 剧本 数据完成");
        thinking.complete();
        return true;
      },
    }),
    set_flowData_scriptPlan: tool({
      description: "保存拍摄计划到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.scriptPlan }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData scriptPlan", value);
        const thinking = msg.thinking("正在保存 拍摄计划 数据");
        socket.emit("setFlowData", { key: "scriptPlan", value });
        thinking.updateTitle("保存 拍摄计划 数据完成");
        thinking.complete();
        return true;
      },
    }),
    add_flowData_assets: tool({
      description: "新增对应衍生资产列表到工作区，严禁包含 不需要新增的数据",
      inputSchema: z.object({ value: z.array(deriveAssetSchema.omit({ id: true })).describe("需要新增的衍生资产列表") }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData add_flowData_assets", value);
        const thinking = msg.thinking("正在保存 衍生资产 数据");
        const setData = [...value] as z.infer<typeof deriveAssetSchema>[];
        const { projectId, scriptId } = resTool.data;
        const startTime = Date.now();

        // 并行插入所有 o_assets 记录
        await Promise.all(
          setData.map(async (i) => {
            const [insertedId] = await u.db("o_assets").insert({
              assetsId: +i.assetsId || null,
              projectId,
              name: i.name,
              type: i.type,
              prompt: i.prompt,
              describe: i.desc,
              startTime,
            });
            i.id = insertedId;
          }),
        );

        // 批量插入 o_scriptAssets
        await u.db("o_scriptAssets").insert(setData.map((i) => ({ scriptId, assetId: i.id })));

        const watiAddAssetsMap: Record<number, z.infer<typeof deriveAssetSchema>[]> = {};
        setData.forEach((i) => {
          if (watiAddAssetsMap[i.assetsId]) {
            watiAddAssetsMap[i.assetsId].push(i);
          } else {
            watiAddAssetsMap[i.assetsId] = [i];
          }
        });
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key: "assets" }, (res: any) => resolve(res)));
        const assetsData = flowData.assets;
        assetsData.forEach((i) => {
          if (watiAddAssetsMap[i.id]) {
            i.derive = [...(i.derive || []), ...watiAddAssetsMap[i.id]];
          }
        });
        thinking.updateTitle("保存 衍生资产 数据完成");
        thinking.complete();

        socket.emit("setFlowData", { key: "assets", value: assetsData });
        return true;
      },
    }),
    update_flowData_assets: tool({
      description: "更新对应衍生资产列表到工作区",
      inputSchema: z.object({ value: z.array(deriveAssetSchema).describe("需要更新的衍生资产列表") }),
      execute: async ({ value }) => {
        console.log("[tools] update_flowData update_flowData_assets", value);
        const thinking = msg.thinking("正在保存 衍生资产 数据");
        for (const i of value) {
          await u
            .db("o_assets")
            .where("id", i.id)
            .update({
              assetsId: +i.assetsId || null,
              projectId: resTool.data.projectId,
              name: i.name,
              type: i.type,
              prompt: i.prompt,
              describe: i.desc,
            });
        }
        // 按 assetsId 分组，构建更新映射
        const updateAssetsMap: Record<number, z.infer<typeof deriveAssetSchema>[]> = {};
        value.forEach((i) => {
          if (updateAssetsMap[i.assetsId]) {
            updateAssetsMap[i.assetsId].push(i);
          } else {
            updateAssetsMap[i.assetsId] = [i];
          }
        });
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key: "assets" }, (res: any) => resolve(res)));
        const assetsData = flowData.assets;
        // 将 derive 中已存在的条目替换为更新后的数据
        assetsData.forEach((asset) => {
          if (updateAssetsMap[asset.id]) {
            const updatedMap = Object.fromEntries(updateAssetsMap[asset.id].map((d) => [d.id, d]));
            asset.derive = (asset.derive || []).map((d) => updatedMap[d.id] ?? d);
          }
        });
        thinking.updateTitle("保存 衍生资产 数据完成");
        thinking.complete();
        socket.emit("setFlowData", { key: "assets", value: assetsData });
        return true;
      },
    }),
    delete_flowData_assets: tool({
      description: "删除对应衍生资产",
      inputSchema: z.object({ ids: z.array(z.number()).describe("需要删除的 衍生资产id ") }),
      execute: async ({ ids }) => {
        console.log("[tools] delete_flowData delete_flowData_assets", ids);
        const thinking = msg.thinking("正在删除指定 衍生资产 数据...");
        await u.db("o_assets").whereIn("id", ids).delete();
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key: "assets" }, (res: any) => resolve(res)));
        const assetsData = flowData.assets;
        assetsData.forEach((i) => {
          i.derive = (i.derive || []).filter((d) => !ids.includes(d.id));
        });
        thinking.updateTitle("删除指定 衍生资产 数据完成");
        thinking.complete();
        // 将 derive 中已存在的条目替换为更新后的数据
        socket.emit("setFlowData", { key: "assets", value: assetsData });
        return true;
      },
    }),
    // set_flowData_assets: tool({
    //   description: "保存衍生资产列表到工作区",
    //   inputSchema: z.object({ value: flowDataSchema.shape.assets }),
    //   execute: async ({ value }) => {
    //     console.log("[tools] set_flowData assets", value);
    //     resTool.systemMessage("正在保存 衍生资产 数据");
    //     if (value && Array.isArray(value) && value.length) {
    //       for (const i of value) {
    //         if (!i?.id) {
    //           const [insertedId] = await u.db("o_assets").insert({
    //             assetsId: null,
    //             name: i.name,
    //             type: i.type,
    //             prompt: i.prompt,
    //             describe: i.desc,
    //             startTime: Date.now(),
    //           });
    //           i.id = insertedId;
    //         }
    //         if (i.derive && Array.isArray(i.derive) && i.derive.length) {
    //           for (const sub of i.derive) {
    //             if (sub.id) continue;
    //             const [insertedId] = await u.db("o_assets").insert({
    //               assetsId: +i.id || null,
    //               projectId: resTool.data.projectId,
    //               name: sub.name,
    //               type: sub.type,
    //               prompt: sub.prompt,
    //               describe: sub.desc,
    //               startTime: Date.now(),
    //             });
    //             await u.db("o_scriptAssets").insert({
    //               scriptId: resTool.data.scriptId,
    //               assetId: insertedId,
    //             });
    //             sub.id = insertedId;
    //           }
    //         }
    //       }
    //     }
    //     socket.emit("setFlowData", { key: "assets", value });
    //     return true;
    //   },
    // }),
    set_flowData_storyboardTable: tool({
      description: "保存分镜表到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.storyboardTable }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData storyboardTable", value);
        const thinking = msg.thinking("正在保存 分镜表 数据...");
        socket.emit("setFlowData", { key: "storyboardTable", value });
        thinking.updateTitle("保存 分镜表 数据完成");
        thinking.complete();
        return true;
      },
    }),
    add_flowData_storyboard: tool({
      description: "新增分镜面板到工作区",
      inputSchema: z.object({ value: z.array(storyboardSchema.omit({ id: true })) }),
      execute: async ({ value }) => {
        console.log("[tools] add_flowData storyboard", value);
        const thinking = msg.thinking("正在保存 分镜面板 数据...");
        const setData = [...value] as z.infer<typeof storyboardSchema>[];
        for (const item of setData) {
          item.src = "";
          const [insertedId] = await u.db("o_storyboard").insert({
            title: item.title,
            prompt: item.prompt,
            description: item.description,
            frameMode: item.frameMode,
            duration: String(item.duration),
            camera: item.camera,
            sound: item.sound,
            lines: item.lines,
            state: "未生成",
            scriptId: resTool.data.scriptId,
            createTime: Date.now(),
          });
          if (item.associateAssetsIds.length) {
            await u.db("o_assets2Storyboard").insert(item.associateAssetsIds.map((i) => ({ storyboardId: insertedId, assetId: i })));
          }
          item.id = insertedId;
        }
        //为了防止丢失分镜其他数据，例如：依赖分镜Id、依赖资产idc
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key: "storyboard" }, (res: any) => resolve(res)));
        const storyboardData = flowData["storyboard"].concat([...setData]);
        socket.emit("setFlowData", { key: "storyboard", value: storyboardData });

        thinking.updateTitle("保存 分镜面板 数据完成");
        thinking.complete();

        return true;
      },
    }),
    update_flowData_storyboard: tool({
      description: "更新指定分镜面板到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.storyboard }),
      execute: async ({ value }) => {
        console.log("[tools] update_flowData storyboard", value);
        const thinking = msg.thinking("正在保存 分镜面板 数据...");
        for (const item of value) {
          await u
            .db("o_storyboard")
            .where("id", item.id)
            .update({
              title: item.title,
              prompt: item.prompt,
              description: item.description,
              frameMode: item.frameMode,
              duration: String(item.duration),
              camera: item.camera,
              sound: item.sound,
              lines: item.lines,
            });
        }
        //直接拉取前端数据，为了防止丢失分镜其他数据，例如：依赖分镜Id、依赖资产idc
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key: "storyboard" }, (res: any) => resolve(res)));
        const storyboardData = flowData["storyboard"].map((existing) => {
          const updated = value.find((v) => v.id === existing.id);
          if (!updated) return existing;
          return {
            ...existing,
            title: updated.title,
            prompt: updated.prompt,
            description: updated.description,
            frameMode: updated.frameMode,
            duration: updated.duration,
            camera: updated.camera,
            sound: updated.sound,
            lines: updated.lines,
          };
        });
        socket.emit("setFlowData", { key: "storyboard", value: storyboardData });
        thinking.updateTitle("保存 分镜面板 数据完成");
        thinking.complete();
        return true;
      },
    }),
    delete_flowData_storyboard: tool({
      description: "删除指定分镜面板并更新工作区",
      inputSchema: z.object({ ids: z.array(z.number()).describe("需要删除的 分镜id ") }),
      execute: async ({ ids }) => {
        console.log("[tools] delete_flowData storyboard", ids);
        const thinking = msg.thinking("正在删除指定 分镜面板 数据...");
        await u.db("o_storyboard").whereIn("id", ids).delete();
        await u.db("o_assets2Storyboard").whereIn("storyboardId", ids).delete();
        await u.db("o_storyboardFlow").whereIn("storyboardId", ids).delete();
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key: "storyboard" }, (res: any) => resolve(res)));
        const storyboardData = flowData["storyboard"].filter((item) => !ids.includes(item.id));
        socket.emit("setFlowData", { key: "storyboard", value: storyboardData });
        thinking.updateTitle("删除指定 分镜面板 数据完成");
        thinking.complete();
        return true;
      },
    }),
    // set_flowData_storyboard: tool({
    //   description: "保存分镜面板到工作区",
    //   inputSchema: z.object({ value: flowDataSchema.shape.storyboard }),
    //   execute: async ({ value }) => {
    //     console.log("[tools] set_flowData storyboard", value);
    //     resTool.systemMessage("正在保存 分镜面板 数据...");
    //     for (const item of value) {
    //       if (!item.id) {
    //         const [insertedId] = await u.db("o_storyboard").insert({
    //           title: item.title,
    //           prompt: item.prompt,
    //           description: item.description,
    //           filePath: item.src,
    //           frameMode: item.frameMode,
    //           duration: String(item.duration),
    //           camera: item.camera,
    //           sound: item.sound,
    //           lines: item.lines,
    //           state: "未生成",
    //           scriptId: resTool.data.scriptId,
    //         });
    //         console.log("%c Line:216 🥥 item.associateAssetsIds", "background:#6ec1c2", item.associateAssetsIds);

    //         if (item.associateAssetsIds.length) {
    //           await u.db("o_assets2Storyboard").insert(item.associateAssetsIds.map((i) => ({ storyboardId: insertedId, assetId: i })));
    //         }
    //         item.id = insertedId;
    //       }
    //     }
    //     socket.emit("setFlowData", { key: "storyboard", value });
    //     return true;
    //   },
    // }),
    set_flowData_workbench: tool({
      description: "保存工作台配置数据到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.workbench }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData workbench", value);
        const thinking = msg.thinking("正在保存 工作台配置 数据...");
        socket.emit("setFlowData", { key: "workbench", value });
        thinking.updateTitle("保存 工作台配置 数据完成");
        thinking.complete();
        return true;
      },
    }),
    set_flowData_poster: tool({
      description: "保存海报配置到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.poster }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData poster", value);
        const thinking = msg.thinking("正在保存 海报配置 数据...");
        thinking.updateTitle("保存 海报配置 数据完成");
        thinking.complete();
        socket.emit("setFlowData", { key: "poster", value });
        return true;
      },
    }),
    // todo 提示词待调
    generate_storyboard_images: tool({
      description: `生成一组图片任务，支持图片间的依赖关系（以图生图），基于有向无环图(DAG)拓扑排序执行。

    参数说明：
    - images: 图片任务数组
      - id: 图片唯一标识符（分镜id）
      - prompt: 图片生成提示词
      - referenceIds: 依赖的参考图id数组，无依赖填空数组[]
      - assetIds: 参考的资产图id数组（可选）

  依赖规则：
    1. referenceIds中的id必须存在于images数组中
    2. 禁止循环依赖（如A依赖B，B依赖A）
    3. 被依赖的图片会先生成，其结果作为参考图传入

    示例：生成猫图，再以猫图为参考生成狗图
    images: [
      {id: 1, prompt: "一只橘猫", referenceIds: [], assetIds: []},
      {id: 2, prompt: "风格相同的金毛犬", referenceIds: [1], assetIds: []}
    ]`,
      inputSchema: z.object({
        images: z.array(
          z.object({
            id: z.number().describe("从工作区获取到的分镜id"),
            prompt: z.string().describe("图片生成提示词"),
            referenceIds: z.array(z.number()).describe("依赖的参考 分镜图id数组，无依赖填空数组[]"),
            assetIds: z.array(z.number()).describe("参考的资产图"),
          }),
        ),
      }),
      execute: async ({ images }) => {
        console.log("[tools] generate_storyboard_images", images);
        const thinking = msg.thinking("正在生成 分镜图片 数据...");
        // --- 构建任务id集合 ---
        const taskIds = new Set(images.map((item) => item.id));
        const imageMap = new Map(images.map((item) => [item.id, item]));

        // --- 检测循环依赖 (Kahn算法拓扑排序) ---
        // 将 referenceIds 分为：本批次内依赖 vs 外部已有依赖
        // 只有本批次内的依赖才参与 DAG 调度，外部依赖直接从数据库获取
        const inDegree = new Map<number, number>();
        // adjacency: 被依赖者 -> 依赖它的节点列表
        const adjacency = new Map<number, number[]>();

        for (const item of images) {
          // 只统计本批次内的依赖作为入度
          const internalDeps = item.referenceIds.filter((refId) => taskIds.has(refId));
          inDegree.set(item.id, internalDeps.length);
          for (const depId of internalDeps) {
            if (!adjacency.has(depId)) adjacency.set(depId, []);
            adjacency.get(depId)!.push(item.id);
          }
        }

        // 拓扑排序，按层级分组（同层可并行）
        const levels: number[][] = [];
        let queue = images.filter((item) => (inDegree.get(item.id) ?? 0) === 0).map((item) => item.id);

        const visited = new Set<number>();
        while (queue.length > 0) {
          levels.push([...queue]);
          const nextQueue: number[] = [];
          for (const nodeId of queue) {
            visited.add(nodeId);
            for (const childId of adjacency.get(nodeId) ?? []) {
              inDegree.set(childId, (inDegree.get(childId) ?? 1) - 1);
              if (inDegree.get(childId) === 0) {
                nextQueue.push(childId);
              }
            }
          }
          queue = nextQueue;
        }
        // 循环依赖检测
        if (visited.size !== images.length) {
          const cyclicIds = images.filter((item) => !visited.has(item.id)).map((item) => item.id);
          thinking.appendText(`检测到循环依赖，涉及分镜id: ${cyclicIds.join(", ")}，请修正后重试`);
          thinking.updateTitle("循环依赖错误");
          thinking.error();
          return `错误：检测到循环依赖，涉及分镜id: ${cyclicIds.join(", ")}`;
        }

        thinking.appendText(`图片生成调度计划：共 ${levels.length} 层，${images.length} 张图片`);

        // --- 准备公共数据 ---
        const projectData = await u.db("o_project").where("id", resTool.data.projectId).select("videoRatio").first();
        const imageModelData = await u.db("o_project").where("id", resTool.data.projectId).select("imageModel", "imageQuality").first();

        // 生成单张图片的函数
        const generateOneImage = async (item: (typeof images)[0]) => {
          const thinking = msg.thinking(`正在生成分镜 id:${item.id} 图片`);
          // 更新数据库状态为生成中
          await u.db("o_storyboard").where("id", item.id).update({ state: "生成中" });
          // 更新前端为生成中
          socket.emit("setFlowData", {
            key: "setStoryboardImage",
            value: { ...item, id: item.id, src: "", state: "生成中", referenceIds: item.referenceIds },
          });

          // 获取参考图base64（包括资产图和已生成的分镜参考图）
          const [assetsBase64, referenceBase64] = await Promise.all([
            getAssetsImageBase64(item.assetIds ?? []),
            getStoryboardImageBase64(item.referenceIds),
          ]);

          const imageCls = await u.Ai.Image(imageModelData.imageModel).run({
            prompt: item.prompt,
            imageBase64: [...assetsBase64, ...referenceBase64],
            size: imageModelData.imageQuality,
            aspectRatio: (projectData?.videoRatio as `${number}:${number}`) ?? "16:9",
            taskClass: "生成图片",
            describe: "分镜图片生成",
            relatedObjects: "hhhh",
            projectId: resTool.data.projectId,
          });

          const savePath = `/${resTool.data.projectId}/storyboard/${u.uuid()}.jpg`;
          await imageCls.save(savePath);

          // 更新数据库状态为已完成
          await u.db("o_storyboard").where("id", item.id).update({ state: "已完成", filePath: savePath });

          const obj = {
            ...item,
            id: item.id,
            src: await u.oss.getFileUrl(savePath),
            state: "已完成",
            referenceIds: item.referenceIds,
          };
          // 前端对话框提示
          thinking.appendText(`分镜 id:${item.id} 图片生成完成`);
          thinking.complete();
          // 更新前端界面展示
          socket.emit("setFlowData", { key: "setStoryboardImage", value: obj });
        };

        // --- 按层级顺序执行：同层并行，层间串行 ---
        for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
          const levelIds = levels[levelIndex];
          const levelItems = levelIds.map((id) => imageMap.get(id)!);
          const thinking = msg.thinking(
            `开始生成第 ${levelIndex + 1}/${levels.length} 层，共 ${levelItems.length} 张图片 (ids: ${levelIds.join(", ")})`,
          );

          // 同层内所有图片并行生成，使用 allSettled 确保不会因单张失败中断整层
          const results = await Promise.allSettled(levelItems.map((item) => generateOneImage(item)));

          // 处理失败的任务
          for (let i = 0; i < results.length; i++) {
            if (results[i].status === "rejected") {
              const failedId = levelIds[i];
              const reason = (results[i] as PromiseRejectedResult).reason;
              console.error(`[tools] 分镜 id:${failedId} 图片生成失败`, reason);
              thinking.appendText(`分镜 id:${failedId} 图片生成失败: ${reason?.message || reason}`);
              await u.db("o_storyboard").where("id", failedId).update({ state: "生成失败" });
              socket.emit("setFlowData", {
                key: "setStoryboardImage",
                value: { id: failedId, src: "", state: "生成失败" },
              });
            }
          }
          thinking.appendText(`第 ${levelIndex + 1}/${levels.length} 层图片生成完成`);
          thinking.complete();
        }
        thinking.appendText("所有分镜图片生成完成");
        thinking.updateTitle("分镜图片生成完成");
        thinking.complete();

        return "分镜图片生成完成";
      },
    }),

    //todo 提示词待调
    generate_assets_images: tool({
      description: `
      生成 资产图片 不区分原资产于衍生资产
      参数说明：
      - images: 图片任务数组
        - assetId: 资产id
        - prompt: 图片生成提示词
      示例：
      images:[
        {assetId: 1, prompt: "一张猫的图片"}
      ]
      `,
      inputSchema: z.object({
        images: z.array(
          z.object({
            assetId: z.number().describe("衍生资产id"),
            prompt: z.string().describe("提示词"),
          }),
        ),
      }),
      execute: async ({ images }) => {
        console.log("[tools] generate_assets_images", images);
        //先获取到前端资产数据
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key: "assets" }, (res: any) => resolve(res)));
        const assetsData = flowData["assets"];
        const assetsImage: { assetId: number; prompt: string; id?: number }[] = [...images];
        //获取对应的 原资产id
        assetsImage.forEach((item) => {
          for (const i of assetsData) {
            const findData = i.derive.find((m) => m.id == item.assetId);
            if (findData) {
              item.id = findData.id;
              break;
            }
          }
        });
        //获取所设置模型
        const imageModelData = await u.db("o_project").where("id", resTool.data.projectId).select("imageModel", "imageQuality").first();
        for (const item of assetsImage) {
          const [imageId] = await u.db("o_image").insert({
            // 数据库插入图片记录
            assetsId: item.assetId,
            model: imageModelData?.imageModel,
            state: "生成中",
            resolution: imageModelData?.imageQuality,
          });
          u.Ai.Image(imageModelData?.imageModel)
            .run({
              prompt: item.prompt,
              imageBase64: await getAssetsImageBase64(item.id ? [item.id] : []),
              size: imageModelData?.imageQuality,
              aspectRatio: "16:9",
              taskClass: "生成图片",
              describe: "资产图片生成",
              relatedObjects: "hhhh",
              projectId: resTool.data.projectId,
            })
            .then(async (imageCls) => {
              const savePath = `/${resTool.data.projectId}/assets/${u.uuid()}.jpg`;
              await imageCls.save(savePath);
              const obj = {
                ...item,
                id: item.assetId,
                src: await u.oss.getFileUrl(savePath),
                state: "已完成",
              };
              //更新对应数据库
              await u.db("o_assets").where("id", item.assetId).update({ imageId: imageId });
              await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath });
              //通知前端更新
              socket.emit("setFlowData", { key: "setAssetsImage", value: obj });
            });
          //通知前端更新状态
          socket.emit("setFlowData", { key: "setAssetsImage", value: { ...item, id: item.assetId, src: "", state: "生成中" } });
        }
        return "资产生成中";
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};

// 获取资产图片base64
async function getAssetsImageBase64(imageIds: number[]) {
  if (imageIds.length === 0) return [];
  const imagePaths = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .whereIn("o_assets.id", imageIds)
    .select("o_assets.id", "o_image.filePath");
  if (!imagePaths.length) return [];
  const imageUrls = await Promise.all(
    imagePaths.map(async (i) => {
      if (i.filePath) {
        try {
          return await urlToBase64(await u.oss.getFileUrl(i.filePath));
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }),
  );
  return imageUrls.filter(Boolean) as string[];
}

//获取分镜图片base64
async function getStoryboardImageBase64(imageIds: number[]) {
  if (!imageIds.length) return [];
  const storayboardData = await u.db("o_storyboard").whereIn("id", imageIds).select("id", "filePath");
  const imageUrls = await Promise.all(
    storayboardData.map(async (i) => {
      if (i.filePath) {
        try {
          return await urlToBase64(await u.oss.getFileUrl(i.filePath));
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }),
  );
  return imageUrls.filter(Boolean) as string[];
}
