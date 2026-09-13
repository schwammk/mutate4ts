export function discount(total) {
  if (total > 100) {
    return 10;
  }
  return 0;
}

export function tier(count) {
  let label = "none";
  if (count >= 5) {
    label = "bulk";
  } else if (count >= 2) {
    label = "some";
  }
  return label;
}
