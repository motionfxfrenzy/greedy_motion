"use client";

import { Suspense } from "react";
import { FilmPage } from "../../components/film-page";

/** /film: write a story, pick a look, get a narrated film. Template cards for story films open it with the look chosen (?look=). */
export default function Film() {
  return <Suspense fallback={null}><FilmPage /></Suspense>;
}
