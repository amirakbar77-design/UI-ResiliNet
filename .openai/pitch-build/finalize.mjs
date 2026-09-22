import path from 'node:path';
import fs from 'node:fs/promises';
import { finalizePresentation } from '/Users/amirulammar/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations/container_tools/artifact_tool_utils.mjs';
const root='/Users/amirulammar/Documents/My VS Code/UI-ResiliNet';
const skill='/Users/amirulammar/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const finalPath=path.join(root,'outputs/resilinet-pitch',process.argv[2] ?? 'ResiliNet-Pitch.pptx');
const result=await finalizePresentation({
workspaceDir:root,candidatePath:path.join(root,'.openai/pitch-build/candidate.pptx'),finalPath,
pythonExecutable:'/Users/amirulammar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-bullet-geometry','--validate-heading-fit'],
explicitTotalSlideCount:9,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],
fontPolicy:{basis:'design',families:['Helvetica Neue']},verifyArtifactToolImport:true,
receiptPath:path.join(root,'.openai/pitch-build',path.basename(finalPath)+'.validation.json')
});
console.log(JSON.stringify(result,null,2));
