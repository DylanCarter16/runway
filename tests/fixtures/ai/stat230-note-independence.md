# Independence

Two events $A$ and $B$ are independent when knowing one happened doesn't change the chance of the other:

$$P(A \cap B) = P(A)P(B)$$

Equivalently, when $P(B) > 0$, $P(A \mid B) = P(A)$.

## Independent vs mutually exclusive

Mutually exclusive means the events can't happen together: $A \cap B = \emptyset$, so $P(A \cap B) = 0$.

These are different ideas. If $P(A) > 0$ and $P(B) > 0$, mutually exclusive events can't be independent, because $P(A)P(B) > 0$ but $P(A \cap B) = 0$. Knowing $A$ happened tells you $B$ didn't.

Example: roll one die. $A$ = even, $B$ = odd are mutually exclusive and dependent. Roll two dice: $A$ = first die even, $B$ = second die even are independent.

## Complements

If $A$ and $B$ are independent, so are $A^c$ and $B$, $A$ and $B^c$, and $A^c$ and $B^c$.
