def divide_total(total: float, count: int) -> float:
    if count == 0:
        return 0.0
    return total / count


def render_report(total: float, count: int) -> str:
    average = divide_total(total, count)
    return f"Average score: {average:.2f}"


if __name__ == "__main__":
    print(render_report(7, 2))
