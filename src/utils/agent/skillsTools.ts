import { tool } from "ai";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import isPathInside from "is-path-inside";
import getPath from "@/utils/getPath";

interface SkillRecord {
  name: string;
  description: string;
  location: string;
  baseDir: string;
}

// ==================== 解析 SKILL.md ====================

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) throw new Error("No frontmatter found");

  const result: Record<string, string> = {};
  const lines = match[1].split("\n");

  for (let i = 0; i < lines.length; ) {
    const colonIndex = lines[i].indexOf(":");
    if (colonIndex === -1) {
      i++;
      continue;
    }

    const key = lines[i].slice(0, colonIndex).trim();
    if (!key) {
      i++;
      continue;
    }

    let value = lines[i].slice(colonIndex + 1).trim();
    i++;

    if (/^[>|]-?$/.test(value)) {
      const fold = value.startsWith(">");
      const parts: string[] = [];
      while (i < lines.length && /^\s+/.test(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      value = fold ? parts.join(" ") : parts.join("\n");
    }

    result[key] = value;
  }

  if (!result.name || !result.description) throw new Error("Frontmatter missing required field: name or description");
  return { name: result.name, description: result.description };
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

// ==================== 资源枚举 ====================

async function listResources(dir: string, base = ""): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listResources(path.join(dir, entry.name), rel)));
    } else if (entry.name !== "SKILL.md") {
      files.push(rel);
    }
  }
  return files;
}

// ==================== 读取单个技能 ====================

async function readSkillFromDir(skillDir: string): Promise<SkillRecord | null> {
  const location = path.join(skillDir, "SKILL.md");
  let content: string;
  try {
    content = await fs.readFile(location, "utf-8");
  } catch {
    return null;
  }
  try {
    const meta = parseFrontmatter(content);
    console.log(`[Skill] ✅ 发现技能：${meta.name} — ${meta.description}`);
    return { ...meta, location, baseDir: skillDir };
  } catch (e) {
    console.log(`[Skill] ⚠️ 解析失败 "${skillDir}"：${(e as Error).message}`);
    return null;
  }
}

// ==================== 构建技能目录 ====================

function buildCatalog(skills: SkillRecord[]): string {
  const entries = skills.map((s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`).join("\n");

  return `## Skills
以下技能提供了专业任务的专用指令。
当任务与某个技能的描述匹配时，调用 activate_skill 工具并传入技能名称来加载完整指令。
加载后遵循技能指令执行任务，需要时调用 read_skill_file 读取资源文件内容。

<available_skills>
${entries}
</available_skills>`;
}

// ==================== 激活 + 执行工具 ====================

function createSkillTools(skills: SkillRecord[]) {
  const activated = new Set<string>();
  const validNames = skills.map((s) => s.name);

  return {
    activate_skill: tool({
      description: `激活一个技能，加载其完整指令和捆绑资源列表到上下文。可用技能：${validNames.join(", ")}`,
      inputSchema: z.object({
        name: z.enum(validNames as [string, ...string[]]).describe("要激活的技能名称"),
      }),
      execute: async ({ name }) => {
        const skill = skills.find((s) => s.name === name);
        if (!skill) return { error: `Skill '${name}' not found` };
        if (activated.has(name)) return { already_active: true, message: `技能 "${name}" 已激活，无需重复加载` };

        let content: string;
        try {
          content = await fs.readFile(skill.location, "utf-8");
        } catch {
          return { error: `Failed to read SKILL.md for '${name}'` };
        }

        const body = stripFrontmatter(content);
        const resources = await listResources(skill.baseDir);
        activated.add(name);

        const resourcesXml =
          resources.length > 0 ? `\n<skill_resources>\n${resources.map((f) => `  <file>${f}</file>`).join("\n")}\n</skill_resources>` : "";

        return {
          content: `<skill_content name="${skill.name}">
${body}

Skill directory: ${skill.baseDir}
相对路径基于此技能目录解析，使用 read_skill_file 工具读取资源文件。
${resourcesXml}
</skill_content>`,
        };
      },
    }),

    read_skill_file: tool({
      description: "读取已激活技能目录下的资源文件。传入 activate_skill 返回的 skill_resources 中的文件路径。",
      inputSchema: z.object({
        skillName: z.string().describe("技能名称"),
        filePath: z.string().describe("资源文件的相对路径，来自 activate_skill 返回的 skill_resources"),
      }),
      execute: async ({ skillName, filePath: relPath }) => {
        const skill = skills.find((s) => s.name === skillName);
        if (!skill) return { error: `Skill '${skillName}' not found` };

        const fullPath = path.resolve(path.join(skill.baseDir, relPath));
        if (!isPathInside(fullPath, skill.baseDir)) return { error: "Access denied: path is outside skill directory" };

        try {
          return { content: await fs.readFile(fullPath, "utf-8") };
        } catch {
          return { error: `File not found: ${relPath}` };
        }
      },
    }),
  };
}

// ==================== 对外接口 ====================

export async function useSkill(...segments: string[]) {
  if (segments.length === 0) return { prompt: "", tools: {} };

  const skills = new Map<string, SkillRecord>();

  const primary = await readSkillFromDir(path.join(getPath("skills"), ...segments));
  if (primary) skills.set(primary.name, primary);

  const publicDir = path.join(getPath("skills"), "public");
  try {
    const entries = await fs.readdir(publicDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = await readSkillFromDir(path.join(publicDir, entry.name));
      if (skill && !skills.has(skill.name)) skills.set(skill.name, skill);
    }
  } catch {
    /* public dir not found */
  }

  if (skills.size === 0) return { prompt: "", tools: {} };

  const allSkills = [...skills.values()];
  return { prompt: buildCatalog(allSkills), tools: createSkillTools(allSkills) };
}
