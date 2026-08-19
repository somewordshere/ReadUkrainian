import { reviewSuggestion } from "./suggestion-review.js";

export function onRequestPost(context) {
  return reviewSuggestion(context, "approved");
}
