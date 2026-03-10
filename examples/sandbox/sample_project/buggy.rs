fn first_word_len(input: &mut String) -> &str {
    let word = input.trim();
    input.push('!');
    word
}

fn main() {
    let mut message = String::from("hello");
    println!("{}", first_word_len(&mut message));
}
