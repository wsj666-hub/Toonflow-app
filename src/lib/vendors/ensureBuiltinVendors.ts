import type { Knex } from "knex";
import { createLocalGeminiImageVendorSeed } from "./localGeminiImage";

type VendorSeed = ReturnType<typeof createLocalGeminiImageVendorSeed>;

function serializeVendor(seed: VendorSeed) {
  return {
    id: seed.id,
    author: seed.author,
    description: seed.description,
    name: seed.name,
    icon: seed.icon,
    inputs: JSON.stringify(seed.inputs),
    inputValues: JSON.stringify(seed.inputValues),
    models: JSON.stringify(seed.models),
    code: seed.code,
    enable: seed.enable,
    createTime: seed.createTime,
  };
}

async function insertVendorIfMissing(knex: Knex, seed: VendorSeed) {
  const exists = await knex("o_vendorConfig").where("id", seed.id).first();
  if (exists) return;
  await knex("o_vendorConfig").insert(serializeVendor(seed));
}

export default async function ensureBuiltinVendors(knex: Knex) {
  await insertVendorIfMissing(knex, createLocalGeminiImageVendorSeed());
}
