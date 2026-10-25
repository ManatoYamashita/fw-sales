/** #371: 別接続の同時書込みでも件数上限を守り、別社を同じロックで待たせない。 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
const A="f3714000-0000-4000-8000-000000000001", B="f3714000-0000-4000-8000-000000000002", U="f3714000-0000-4000-8000-00000000000a";
let connection:postgres.Sql;
beforeAll(async()=>{
  expect(process.env.APP_ENV).toBe("local");
  connection=postgres(process.env.DATABASE_URL!,{prepare:false,max:3});
  for(const [id,slug] of [[A,"template-concurrency-a"],[B,"template-concurrency-b"]]) await connection`INSERT INTO tenants(id,slug,name,created_at,updated_at) VALUES(${id!},${slug!},${slug!},'2026-10-25','2026-10-25')`;
  await connection`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(${U},'template-concurrency@example.test','{}')`;
  for(const tenant of [A,B]) await connection`INSERT INTO memberships(tenant_id,user_id,role,created_at,updated_at) VALUES(${tenant},${U},'member','2026-10-25','2026-10-25')`;
});
beforeEach(async()=>{
  for(const tenant of [A,B]) for(let i=0;i<4;i++) await connection`INSERT INTO ai_prompt_templates(tenant_id,user_id,name,body,created_at,updated_at) VALUES(${tenant},${U},${`seed-${i}`},'body','2026-10-25','2026-10-25')`;
});
afterEach(async()=>{await connection`DELETE FROM ai_prompt_templates WHERE tenant_id IN (${A},${B}) AND user_id=${U}`;});
afterAll(async()=>{
  if(!connection)return;
  try {await connection`DELETE FROM auth.users WHERE id=${U}`;await connection`DELETE FROM tenants WHERE id IN (${A},${B})`;} finally {await connection.end({timeout:5});}
});

it("残り1枠への同時INSERTは一方だけを許可し、最大5件を超えない",async()=>{
  const insert=(name:string)=>connection.begin(tx=>tx`INSERT INTO ai_prompt_templates(tenant_id,user_id,name,body,created_at,updated_at) VALUES(${A},${U},${name},'body','2026-10-25','2026-10-25')`);
  const results=await Promise.allSettled([insert("race-a"),insert("race-b")]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  const denied=results.find(r=>r.status==="rejected");
  expect(denied?.status==="rejected"?denied.reason:null).toMatchObject({code:"P0001"});
  expect(await connection`SELECT count(*)::int AS n FROM ai_prompt_templates WHERE tenant_id=${A} AND user_id=${U}`).toEqual([{n:5}]);
},15000);

it("Aで実INSERTのロックを保持していても、兼務者のBへのINSERTは待たない",async()=>{
  let release!:()=>void,acquired!:()=>void;
  const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{acquired=r;});
  const held=connection.begin(async tx=>{
    await tx`INSERT INTO ai_prompt_templates(tenant_id,user_id,name,body,created_at,updated_at) VALUES(${A},${U},'held','body','2026-10-25','2026-10-25')`;
    acquired();await gate;
  });
  try {
    await Promise.race([ready,held.then(()=>{throw new Error("holder ended before lock acquisition");})]);
    await connection.begin(async tx=>{
      await tx`SET LOCAL lock_timeout='500ms'`;
      await tx`INSERT INTO ai_prompt_templates(tenant_id,user_id,name,body,created_at,updated_at) VALUES(${B},${U},'independent','body','2026-10-25','2026-10-25')`;
    });
  } finally {release();await held;}
  expect(await connection`SELECT tenant_id,count(*)::int AS n FROM ai_prompt_templates WHERE user_id=${U} AND tenant_id IN (${A},${B}) GROUP BY tenant_id ORDER BY tenant_id`).toEqual([{tenant_id:A,n:5},{tenant_id:B,n:5}]);
},15000);
