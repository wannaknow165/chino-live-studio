// Audio-clock mouth poses. These are language-independent acoustic estimates,
// not a claim of perfect Hebrew phoneme recognition.
const poses = {
 X: {jawOpen:0}, A:{jawOpen:.035,mouthClose:.035,mouthPressLeft:.12,mouthPressRight:.12},
 B:{jawOpen:.10,mouthStretchLeft:.10,mouthStretchRight:.10},
 C:{jawOpen:.34}, D:{jawOpen:.62}, E:{jawOpen:.27,mouthFunnel:.35},
 F:{jawOpen:.14,mouthFunnel:.40,mouthPucker:.20},
 G:{jawOpen:.07,mouthRollLower:.35}, H:{jawOpen:.24,tongueOut:.08},
};
export function cuePose(cues, time) {
  const cue = cues?.find(c => time >= c.start && time < c.end);
  return {...(poses[cue?.value] || poses.X)};
}
