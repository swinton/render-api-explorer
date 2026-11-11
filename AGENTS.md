# Collection design

Keep the API reference as the foundation and add focused, use case centric
walkthroughs alongside it.

- Organize reference folders by API resource. Expose each endpoint independently
  so users can explore beyond the guided workflows. Expand coverage incrementally;
  a walkthrough does not replace reference coverage for its API area.
- Organize walkthroughs around concrete outcomes, such as sharing one Git build
  across multiple services. Include prerequisites, ordered steps, variables to
  fill in, and instructions for checking the result.
- Generate both layers from the same upstream API definitions so endpoint paths
  and request formats stay consistent.
- Make requests that change resources explicit. Explain when steps are optional
  and when users must wait for a result before continuing.
