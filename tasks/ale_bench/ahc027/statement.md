You are a world-class algorithm engineer, and you are very good at programming. Now, you are participating in a programming contest. You are asked to solve a heuristic problem, known as an NP-hard problem.

Story
--------
F Corporation developed a robotic vacuum cleaner, Takahashi-kun cleaner No.2, and decided to entrust it with the cleaning of their office.
Takahashi-kun cleaner No.2 can operate indefinitely through solar power and repeats cleaning on a predetermined route indefinitely.
The office has varying levels of susceptibility to dirt in different areas, and by frequently cleaning the areas that are more prone to dirt, the entire office can be kept cleaner.

Problem Statement
--------
There is an $N\times N$ square board.
Let $(0, 0)$ be the coordinates of the top-left square, and $(i, j)$ be the coordinates of the square located $i$ squares down and $j$ squares to the right from there.
The perimeter of the $N\times N$ board is surrounded by walls, and there may also be walls between adjacent squares.

Each square $(i,j)$ is assigned a value $d_{i,j}$ which represents its susceptibility to dirt.
Your task is to clean these squares by moving around the board.
You can move to an adjacent square that is not blocked by a wall.
After the move, the dirtiness of the square you moved to becomes $0$, and the dirtiness of all other squares $(i, j)$ increases by $d_{i, j}$.
Consider a cleaning route that starts and ends at $(0, 0)$, with a length (number of moves) not exceeding $10^5$.
The cleaning route may pass through the same square multiple times, but must visit each square at least once.

Let $a_{t,i,j}$ denote the dirtiness of each square $(i,j)$ after the $t$-th move, and let $S_t=\sum_{i=0}^{N-1}\sum_{j=0}^{N-1} a_{t,i,j}$ denote the total dirtiness.
At $t=0$, we assume that the dirtiness of all squares is $a_{0,i,j}=0$.
Define the **average dirtiness** as
\\[
  \bar{S}=\frac{1}{L}\sum_{t=L}^{2L-1}S_t,
\\]
which is the average of the total dirtiness during the period $t=L,L+1,\cdots,2L-1$ when the cleaning route of length $L$ is repeated infinitely.

Please find a cleaning route that minimizes the average dirtiness as much as possible.

#### The Meaning of Average Dirtiness 
We can prove that $a_{t,i,j}=a_{t+L,i,j}$ for $t\geq L$ when the cleaning route of length $L$ is repeated infinitely.
Therefore, considering the average $\frac{1}{T} \sum_{t=0}^{T-1} S_t$ of the total dirtiness up to $T$ turns, its limit as $T \to \infty$ coincides with the average dirtiness.


Scoring
--------
Let $\bar{S}$ be the average dirtiness of the output cleaning route.
Then you will obtain an absolute score of $\mathrm{round}(\bar{S})$.
The lower the absolute score, the better.
If you output an illegal cleaning route (length exceeds $10^5$, does not return to $(0,0)$, there is an unvisited square, or it hits a wall), it will be judged as <span class='label label-warning' data-toggle='tooltip' data-placement='top' title="Wrong Answer">WA</span>.

For each test case, we compute the <font color="red"><strong>relative score</strong></font> $\mathrm{round}(10^9\times \frac{\mathrm{MIN}}{\mathrm{YOUR}})$, where YOUR is your absolute score and MIN is the lowest absolute score among all competitors obtained on that test case. The score of the submission is the sum of the relative scores.

The final ranking will be determined by the system test with more inputs which will be run after the contest is over.
In both the provisional/system test, if your submission produces illegal output or exceeds the time limit for some test cases, only the score for those test cases will be zero, and your submission will be excluded from the MIN calculation for those test cases.

The system test will be performed only for <font color="red"><strong>the last submission which received a result other than <span class="label label-warning" data-toggle="tooltip" data-placement="top" title="" data-original-title="Compilation Error">CE</span> </strong></font>.
Be careful not to make a mistake in the final submission.


#### Number of test cases
- Provisional test: 50
- System test: 2000. We will publish <a href="https://img.atcoder.jp/ahc027/seeds.txt">seeds.txt</a>  (sha256=cdea33a6050850bf1387e2191b802a1df7e43fcb969fd6c3bf9cbd96a4d790d7) after the contest is over.

#### About relative evaluation system
In both the provisional/system test, the standings will be calculated using only the last submission which received a result other than <span class="label label-warning" data-toggle="tooltip" data-placement="top" title="" data-original-title="Compilation Error">CE</span>.
Only the last submissions are used to calculate the MIN for each test case when calculating the relative scores.

The scores shown in the standings are relative, and whenever a new submission arrives, all relative scores are recalculated.
On the other hand, the score for each submission shown on the submissions page is the sum of the absolute score for each test case, and the relative scores are not shown.
In order to know the relative score of submission other than the latest one in the current standings, you need to resubmit it.
If your submission produces illegal output or exceeds the time limit for some test cases, the score shown on the submissions page will be 0, but the standings show the sum of the relative scores for the test cases that were answered correctly.

#### About execution time
Execution time may vary slightly from run to run.
In addition, since system tests simultaneously perform a large number of executions, it has been observed that execution time increases by several percent compared to provisional tests.
For these reasons, submissions that are very close to the time limit may result in <span class='label label-warning' data-toggle='tooltip' data-placement='top' title="Time Limit Exceeded">TLE</span> in the system test.
Please measure the execution time in your program to terminate the process, or have enough margin in the execution time.


Input
--------
Input is given from Standard Input in the following format.

~~~
$N$
$h_{0,0}\cdots h_{0,N-1}$
$\vdots$
$h_{N-2,0} \cdots h_{N-2,N-1}$
$v_{0,0} \cdots v_{0,N-2}$
$\vdots$
$v_{N-1,0} \cdots v_{N-1,N-2}$
$d_{0,0}$ $\cdots$ $d_{0,N-1}$
$\vdots$
$d_{N-1,0}$ $\cdots$ $d_{N-1,N-1}$
~~~

- $N$ is the horizontal and vertical size of the board and satisfies $20\leq N\leq 40$.
- $h_{i,0}\cdots h_{i,N-1}$ is a string of length $N$ consisting of only `0` and `1`. $h_{i,j}=1$ if and only if there is a wall between square $(i,j)$ and its lower neighbor $(i+1,j)$.
- $v_{i,0}\cdots v_{i,N-2}$ is a string of length $N-1$ consisting of only `0` and `1`. $v_{i,j}=1$ if and only if there is a wall between square $(i,j)$ and its right neighbor $(i,j+1)$.
- All squares are guaranteed to be reachable from $(0, 0)$.
- $d_{i,j}$ is an integer value representing the susceptibility to dirt of square $(i,j)$ and satisfies $1\leq d_{i,j}\leq 10^3$.


Output
--------
Represent a move up, down, left, or right by `U`, `D`, `L`, or `R`, respectively.
Represent the cleaning route of length $L$ as a string of $L$ characters corresponding to each move, and output it in a single line to Standard Output.


<a href="https://img.atcoder.jp/ahc027/aPdjCUIZ.html?lang=en&seed=0&output=sample">Show example</a>


Sample Solution
--------
<details>
This is a sample solution in Python.
In this program, by moving along the depth-first search tree starting from (0,0), each edge in the tree is passed twice, once on the way there and once on the way back, and the program outputs a cleaning route that returns to (0,0).
<pre class="prettyprint linenums">
import sys
sys.setrecursionlimit(1000000)

N = int(input())
h = [input() for _ in range(N-1)]
v = [input() for _ in range(N)]
d = [list(map(int, input().split())) for _ in range(N)]

visited = [[False for _ in range(N)] for _ in range(N)]
DIJ = [(0, 1), (1, 0), (0, -1), (-1, 0)]
DIR = "RDLU"

def dfs(i, j):
  visited[i][j] = True
  for dir in range(4):
    di, dj = DIJ[dir]
    i2 = i + di
    j2 = j + dj
    if 0 <= i2 < N and 0 <= j2 < N and not visited[i2][j2]:
      if di == 0 and v[i][min(j, j2)] == '0' or dj == 0 and h[min(i, i2)][j] == '0':
        print(DIR[dir], end='')
        dfs(i2, j2)
        print(DIR[(dir + 2) % 4], end='')

dfs(0, 0)
print()
</pre>
</details>


Input Generation
--------
<details>
Let $\mathrm{randint}(L,U)$ be a function that generates a uniform random integer between $L$ and $U$, inclusive.
Let $\mathrm{randdouble}(L,U)$ be a function that generates a uniform random floating-point number at least $L$ and less than $U$.

#### Generation of $N$
$N=\mathrm{randint}(20,40)$.

#### Generation of $h$ and $v$
Generate a parameter $w=\mathrm{randint}(1,N)$ that controls the number of walls.
Starting from a state with no walls, generate walls by repeating the following operation $w$ times.

Randomly select one of the four directions (up, down, left, right).
For the left direction, generate $i=\mathrm{randint}(0,N-2)$, $j=\mathrm{randint}(0,N-1)$, and $k=\mathrm{randint}(3,\lfloor N/2\rfloor)$.
Then, set $h_{i,j}\cdots h_{i,\max(j-k+1, 0)}$ to $1$.
Similarly, for the right direction, generate values in the same manner, and set $h_{i,j}\cdots h_{i,\min(j+k-1, N-1)}$ to $1$.
For the upward direction, generate $i=\mathrm{randint}(0,N-1)$, $j=\mathrm{randint}(0,N-2)$, and $k=\mathrm{randint}(3,\lfloor N/2\rfloor)$.
Then, set $v_{i,j}\cdots v_{\max(i-k+1, 0),j}$ to $1$.
Similarly, for the downward direction, generate values in the same manner, and set $v_{i,j}\cdots v_{\min(i+k-1, N-1),j}$ to $1$.

After $w$ iterations are completed, check if all squares are reachable from $(0, 0)$, and if there are unreachable squares, remove all walls and redo the $w$ iterations.

#### Generation of $d$
Generate a parameter $c=\mathrm{randint}(1,\lfloor N/2\rfloor)$ that determines the number of susceptible regions.
Create an array $d'$ with $d'_{i,j}=0$ for all $(i,j)$, and update $d'$ by repeating the following process $c$ times.

Generate $i=\mathrm{randint}(0,N-1)$, $j=\mathrm{randint}(0,N-1)$, $m=\mathrm{randint}(N,\lfloor N^2/c\rfloor)$, and $b=\mathrm{randdouble}(0,2)$.
Generate a set $S$ by starting from $S=\\{(i,j)\\}$ and repeating the following process until the size of $S$ becomes $m$.

Randomly choose $p\in S$, and randomly choose one of the four directions (up, down, left, or right). If there is no wall in that direction from $p$, add the adjacent square $q$ to $S$.

For each square $(i',j')\in S$ contained in the generated $S$, overwrite $d'_{i',j'}=b$.

After $c$ iterations are completed, generate $d_{i,j}=\mathrm{round}(10^{d'_{i,j}+\mathrm{randdouble}(0,1)})$ for each $(i,j)$.
</details>

Tools (Input generator and visualizer)
--------
- <a href="https://img.atcoder.jp/ahc027/aPdjCUIZ.html?lang=en">Web version</a>: This is more powerful than the local version providing animations.
- <a href="https://img.atcoder.jp/ahc027/aPdjCUIZ_v2.zip">Local version</a>: You need a compilation environment of <a href="https://www.rust-lang.org/">Rust language</a>.
  - <a href="https://img.atcoder.jp/ahc027/aPdjCUIZ_windows_v2.zip">Pre-compiled binary for Windows</a>: If you are not familiar with the Rust language environment, please use this instead.

Please be aware that sharing visualization results or discussing solutions/ideas during the contest is prohibited.

{sample example}


    Problem constraints:
    time_limit=2.0 memory_limit=1073741824
