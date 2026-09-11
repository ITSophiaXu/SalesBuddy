import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPoster,buildPosterSVG} from '../poster.js';
const require=createRequire(import.meta.url);
const sharp=require(process.argv[2]||'sharp');
const out=resolve('artifacts');await mkdir(out,{recursive:true});
const base=createPoster({workspaceName:'Atlas Motors',customer:{id:'sample',name:'Sample',language:'en',city:'Austin',vehicle:'Explore your next SUV'},campaign:{title:'Family test-drive concept',market:'US'}}).poster;
const samples=[
  {file:'motive-poster-portrait',spec:{...base,size:'portrait',headline:'Room for\nwhat matters.',subheadline:'Bring your questions. Explore the space.\nFind a drive that fits your everyday.',kicker:'THE FAMILY DRIVE / EXPERIENCE',details:'Austin showroom · Request an appointment',disclaimer:'Concept creative. Test-drive times, local availability and vehicle specifications require showroom confirmation.'}},
  {file:'motive-poster-square',spec:{...base,size:'square',theme:'midnight',headline:'Your next chapter.\nStarts with a drive.'}},
  {file:'motive-poster-story-ar',spec:{...base,size:'story',theme:'sand',language:'ar',kicker:'تجربة قيادة / سيارتك القادمة',headline:'مساحة لكل\nما يهمك.',subheadline:'اكتشف السيارة التي تناسب يومك.\nأحضر أسئلتك واستمتع بالتجربة.',vehicle:'اكتشف سيارتك الرياضية متعددة الاستخدامات',details:'دبي · المواعيد والتوافر بحاجة إلى تأكيد',cta:'اطلب تجربة قيادة',disclaimer:'تصميم مقترح. الصورة توضيحية. يجب تأكيد المواصفات والتوافر وتفاصيل الفعالية لدى المعرض قبل النشر.'}}
];
for(const sample of samples){const svg=buildPosterSVG(sample.spec);await writeFile(resolve(out,sample.file+'.svg'),svg);await sharp(Buffer.from(svg)).png().toFile(resolve(out,sample.file+'.png'));}
const thumbnails=await Promise.all(samples.map(async(sample,index)=>({input:await sharp(resolve(out,sample.file+'.png')).resize({width:432}).png().toBuffer(),left:32+index*464,top:32})));
await sharp({create:{width:1424,height:832,channels:4,background:'#eeeae2'}}).composite(thumbnails).png().toFile(resolve(out,'motive-posters-preview.png'));
process.stdout.write(`Rendered ${samples.length} poster formats in ${out}\n`);
