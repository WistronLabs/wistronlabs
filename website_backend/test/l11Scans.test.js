const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');const assert=require('node:assert/strict');
const path=require('node:path');
const test=require('node:test');
const project=path.resolve(__dirname,'../..');
const {createL11Scans}=require(project+'/website_backend/src/services/l11Scans');
test("persistent scans survive restart, deduplicate, and follow Received/rack context", async()=>{
 const pg=new PGlite();
 await pg.exec(`CREATE TABLE system(id serial PRIMARY KEY,service_tag text,rack_service_tag text);
 CREATE TABLE users(id serial PRIMARY KEY,username text);
 CREATE TABLE system_location_history(id serial PRIMARY KEY,system_id int,from_location_id int,to_location_id int,changed_at timestamptz DEFAULT now());
 INSERT INTO users VALUES(1,'receiver@example.test');
 INSERT INTO system VALUES(1,'ABC1234','RACK123');
 INSERT INTO system_location_history(system_id,to_location_id) VALUES(1,1);`);
 await pg.exec(fs.readFileSync(project+'/website_backend/db_migrations/0016-persistent-l11-scans.sql','utf8'));
 const db={query:(...args)=>pg.query(...args),connect:async()=>({query:(...args)=>pg.query(...args),release(){}})};
 const starts=[];let runnerStatus='running';
 const deps={db,submit:async(tag,rack)=>{starts.push([tag,rack]);return{job_id:'runner-'+starts.length}},getJob:async()=>({status:runnerStatus,stdout:'[hook] Rack folder in MFT not found: dell-mft:/L11/RACK123.1/'})};
 let scans=createL11Scans(deps);
 const first=await scans.request('ABC1234',1,'received');
 const same=await scans.request('ABC1234',1,'manual');assert.equal(first.id,same.id);
 await scans.tick();assert.equal(starts.length,1);
 scans=createL11Scans(deps);await scans.tick();assert.equal(starts.length,1,'restart must reconnect');
 assert.equal((await scans.history('ABC1234'))[0].status,'running');
 runnerStatus='succeeded';await scans.tick();assert.equal((await scans.history('ABC1234'))[0].status,'succeeded');
 // Unchanged rack, new Received event creates a distinct job.
 await pg.query('INSERT INTO system_location_history(system_id,to_location_id) VALUES(1,1)');
 const next=await scans.request('ABC1234',1,'received');assert.notEqual(next.id,first.id);
 await pg.query("UPDATE system SET rack_service_tag='NEWRACK' WHERE id=1");
 const third=await scans.request('ABC1234',1,'rack_changed');
 await scans.tick();assert.equal((await scans.history('ABC1234')).find(x=>x.id===next.id).status,'outdated');
 await scans.tick();assert.deepEqual(starts.at(-1),['ABC1234','NEWRACK']);
 const history=await scans.history('ABC1234');assert.equal(history[0].id,third.id);assert.equal(history[0].requested_by_name,'receiver@example.test');assert.equal(history.find(x=>x.id===first.id).current,false);
 await pg.query("UPDATE l11_scan_job SET status='dispatching',runner_job_id=NULL WHERE id=$1",[third.id]);
 scans=createL11Scans(deps);await scans.tick();assert.equal((await scans.history('ABC1234'))[0].status,'unknown');assert.equal(starts.length,2);
 // A late archive produced by an older Received scan must not authorize this cycle.
 const vm=require('node:vm'); const os=require('node:os'); const fsp=require('node:fs/promises');
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'stale-l11-test-'));
 try {
   await fsp.mkdir(path.join(root,'ABC1234'));
   const file=path.join(root,'ABC1234','L11_logs_ST_ABC1234_RT_RACK123.tgz');
   await fsp.writeFile(file,'logs');
   await pg.query("UPDATE l11_scan_job SET received_at='2020-01-01',started_at='2020-01-03',ended_at='2020-01-05',status='succeeded' WHERE id=$1",[first.id]);
   const source=fs.readFileSync(project+'/website_backend/src/routes/systems.js','utf8');
   const helper=source.slice(source.indexOf('async function hasL11ArchiveForServiceTagAndRack('),source.indexOf('async function getLatestReceivedAt('));
   const context=vm.createContext({fs:fsp,path,db,DateTime:require('luxon').DateTime,getServerTimeZone:()=> 'UTC',escapeRegExp:value=>value});
   vm.runInContext(helper,context);
   await fsp.utimes(file,new Date('2020-01-04'),new Date('2020-01-04'));
   assert.equal(await context.hasL11ArchiveForServiceTagAndRack(root,'ABC1234','RACK123','2020-01-02'),false);
   await fsp.utimes(file,new Date('2020-01-06'),new Date('2020-01-06'));
   assert.equal(await context.hasL11ArchiveForServiceTagAndRack(root,'ABC1234','RACK123','2020-01-02'),true);
 } finally { await fsp.rm(root,{recursive:true,force:true}); }
 await pg.close();
});
