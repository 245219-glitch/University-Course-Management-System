// Default grading scale (percentage -> letter, grade points). Passing = points > 0.
const SCALE = [
  [85, 'A', 4.0], [80, 'A-', 3.67], [75, 'B+', 3.33], [70, 'B', 3.0], [65, 'B-', 2.67],
  [61, 'C+', 2.33], [58, 'C', 2.0], [55, 'C-', 1.67], [50, 'D', 1.0]
];
function gradeFromPercentage(p) {
  for (const [min, letter, points] of SCALE) if (p >= min) return { letter, points };
  return { letter: 'F', points: 0 };
}
module.exports = { gradeFromPercentage, SCALE };
